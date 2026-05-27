import { useState, useEffect, useRef } from 'react'
import { supabase, BUCKET, isConfigured } from './lib/supabase.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const genId   = () => 'J' + Date.now().toString(36).toUpperCase()
const fileExt = name => name ? name.split('.').pop().toLowerCase() : ''
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtTs   = d => d ? new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const P = {
  kmlBooking:   id           => `${id}/area_file`,
  opsBooking:   (id, name)   => `${id}/ops_booking.${fileExt(name)}`,
  kmlFlight:    id           => `${id}/kml_flight.kml`,
  screenshot:   (id, name)   => `${id}/screenshot.${fileExt(name)}`,
  opsCompleted: (id, name)   => `${id}/ops_completed.${fileExt(name)}`,
}

async function upload(path, file) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
  if (error) console.error('Upload error:', error)
  return !error
}

function publicUrl(path) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data?.publicUrl
}

async function downloadText(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  return await data.text()
}

function triggerDownload(url, filename) {
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.target = '_blank'; a.click()
}

const getSettings    = () => { try { return JSON.parse(localStorage.getItem('hqp_cfg') || '{}') } catch { return {} } }
const saveSettings   = s  => localStorage.setItem('hqp_cfg', JSON.stringify(s))
const getPin         = () => getSettings().pin || '1234'
const getNotifyEmail = () => getSettings().notifyEmail || ''

// ── Priority & FY helpers ─────────────────────────────────────────────────────

const PRIORITY = {
  urgent: { label: 'Urgent', clr: '#ef4444', bg: '#300a0a', symbol: '▲▲' },
  high:   { label: 'High',   clr: '#f97316', bg: '#2d1200', symbol: '▲'  },
  medium: { label: 'Medium', clr: '#d97706', bg: '#1a1200', symbol: '◆'  },
  low:    { label: 'Low',    clr: '#4ade80', bg: '#052e16', symbol: '▼'  },
}

function getCurrentFY() {
  const now = new Date()
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  return {
    start: new Date(y, 6, 1),
    end:   new Date(y + 1, 5, 30, 23, 59, 59),
    label: `FY ${y}/${String(y + 1).slice(2)}`,
  }
}

function getFYHectares(jobs) {
  const { start, end } = getCurrentFY()
  return jobs
    .filter(j => j.status === 'completed' && j.hectares && j.completed_at)
    .filter(j => { const d = new Date(j.completed_at); return d >= start && d <= end })
    .reduce((sum, j) => sum + (parseFloat(j.hectares) || 0), 0)
}

// Parse a Kestrel CSV export — handles various column name formats
function parseKestrelCSV(text) {
  try {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) return null
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''))
    // Use last data row (most recent reading)
    const raw = lines[lines.length - 1].split(',').map(v => v.trim().replace(/['"]/g, ''))
    const get = (...keys) => {
      for (const k of keys) {
        const i = headers.findIndex(h => h.includes(k))
        if (i >= 0 && raw[i] && raw[i] !== '') return raw[i]
      }
      return ''
    }
    // Extract time from date column if present
    let time = ''
    const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('time'))
    if (dateIdx >= 0 && raw[dateIdx]) {
      const match = raw[dateIdx].match(/(\d{1,2}:\d{2})/)
      if (match) time = match[1]
    }
    return {
      temp:      get('temperature', 'temp'),
      windSpeed: get('wind speed', 'windspeed', 'avg wind', 'average wind'),
      windDir:   get('direction', 'wind dir'),
      humidity:  get('humidity', 'relative humidity', 'rh'),
      dewPoint:  get('dew point', 'dewpoint'),
      densAlt:   get('density alt', 'density altitude'),
      time,
      notes: 'Imported from Kestrel CSV',
    }
  } catch { return null }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS = {
  pending:       { label: 'Pending',      clr: '#d97706', bg: '#451a03' },
  scheduled:     { label: 'Scheduled',    clr: '#60a5fa', bg: '#0c1f3a' },
  'in-progress': { label: 'In Progress',  clr: '#a78bfa', bg: '#1e0a40' },
  completed:     { label: 'Completed',    clr: '#4ade80', bg: '#052e16' },
  cancelled:     { label: 'Cancelled',    clr: '#f87171', bg: '#300a0a' },
}

// ── Primitives ────────────────────────────────────────────────────────────────

const Badge = ({ s }) => {
  const c = STATUS[s] || STATUS.pending
  return (
    <span style={{ background: c.bg, color: c.clr, border: `1px solid ${c.clr}55`, padding: '2px 9px', borderRadius: 3, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.clr, display: 'inline-block' }} />
      {c.label}
    </span>
  )
}

const PriBadge = ({ p }) => {
  const c = PRIORITY[p] || PRIORITY.medium
  return (
    <span style={{ background: c.bg, color: c.clr, border: `1px solid ${c.clr}55`, padding: '2px 8px', borderRadius: 3, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {c.symbol} {c.label}
    </span>
  )
}

const Btn = ({ children, onClick, variant = 'primary', sm, disabled, full }) => {
  const V = {
    primary: { background: '#d97706', color: '#0e1a0e', border: 'none' },
    ghost:   { background: 'transparent', color: '#5a7a5a', border: '1px solid #1e2e1e' },
    green:   { background: '#041f0e', color: '#4ade80', border: '1px solid #4ade8055' },
    red:     { background: 'transparent', color: '#f87171', border: '1px solid #f8717155' },
  }[variant] || {}
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...V, padding: sm ? '4px 10px' : '7px 16px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: sm ? 10 : 11, letterSpacing: 1, textTransform: 'uppercase', opacity: disabled ? 0.4 : 1, width: full ? '100%' : 'auto', flexShrink: 0 }}>
      {children}
    </button>
  )
}

const Lbl = ({ children }) => (
  <div style={{ color: '#3d5a3d', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 5, fontFamily: 'monospace' }}>{children}</div>
)

const Inp = ({ style, ...p }) => (
  <input style={{ width: '100%', background: '#080d08', border: '1px solid #1e2e1e', color: '#c8dcc8', padding: '7px 10px', borderRadius: 3, fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box', ...style }} {...p} />
)

const Txta = ({ style, ...p }) => (
  <textarea style={{ width: '100%', background: '#080d08', border: '1px solid #1e2e1e', color: '#c8dcc8', padding: '7px 10px', borderRadius: 3, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', minHeight: 68, boxSizing: 'border-box', ...style }} {...p} />
)

const Sel = ({ children, style, ...p }) => (
  <select style={{ width: '100%', background: '#080d08', border: '1px solid #1e2e1e', color: '#c8dcc8', padding: '7px 10px', borderRadius: 3, fontFamily: 'monospace', fontSize: 12, ...style }} {...p}>{children}</select>
)

const FF = ({ label, children, hint }) => (
  <div style={{ marginBottom: 12 }}>
    <Lbl>{label}</Lbl>
    {children}
    {hint && <div style={{ color: '#2a4a2a', fontSize: 9, marginTop: 3 }}>{hint}</div>}
  </div>
)

const FileBtn = ({ label, accept, onChange, done }) => {
  const id = 'f' + Math.random().toString(36).slice(2)
  return (
    <label htmlFor={id} style={{ display: 'block', border: `1px dashed ${done ? '#4ade8060' : '#1e2e1e'}`, borderRadius: 4, padding: '9px 12px', cursor: 'pointer', background: done ? '#031a0c' : 'transparent' }}>
      <input id={id} type="file" accept={accept} style={{ display: 'none' }} onChange={onChange} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, color: done ? '#4ade80' : '#3a5a3a' }}>{done ? '✓' : '⬆'}</span>
        <div>
          <div style={{ color: done ? '#4ade80' : '#4a6a4a', fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{done || label}</div>
          <div style={{ color: '#2a4a2a', fontSize: 9 }}>click to {done ? 'replace' : 'upload'}</div>
        </div>
      </div>
    </label>
  )
}

const ModalWrap = ({ children }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px' }}>
    {children}
  </div>
)

const ModalBox = ({ title, onClose, children, maxW = 600 }) => (
  <ModalWrap>
    <div style={{ background: '#0c100c', border: '1px solid #243424', borderRadius: 6, width: '100%', maxWidth: maxW, boxShadow: '0 24px 60px rgba(0,0,0,0.9)' }}>
      <div style={{ padding: '13px 18px', borderBottom: '1px solid #1a2a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'monospace', color: '#d97706', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>{title}</span>
        {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#3a5a3a', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>✕</button>}
      </div>
      <div style={{ padding: 18, maxHeight: '78vh', overflowY: 'auto' }}>{children}</div>
    </div>
  </ModalWrap>
)

// ── Priority + FY Summary ─────────────────────────────────────────────────────

function PrioritySummary({ jobs }) {
  const fy = getCurrentFY()
  const fyHa = getFYHectares(jobs)
  const active = jobs.filter(j => !['completed', 'cancelled'].includes(j.status))
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 8 }}>
        {Object.entries(PRIORITY).map(([k, v]) => {
          const count = active.filter(j => (j.priority || 'medium') === k).length
          return (
            <div key={k} style={{ background: v.bg, border: `1px solid ${v.clr}35`, borderRadius: 5, padding: '10px 0', textAlign: 'center' }}>
              <div style={{ color: v.clr, fontSize: 13, fontFamily: 'monospace', marginBottom: 4 }}>{v.symbol}</div>
              <div style={{ color: v.clr, fontSize: 26, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1 }}>{count}</div>
              <div style={{ color: v.clr + 'aa', fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 4 }}>{v.label}</div>
            </div>
          )
        })}
      </div>
      <div style={{ background: '#0a140a', border: '1px solid #2a4a2a', borderRadius: 5, padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: '#3a5a3a', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1.5 }}>{fy.label} — Completed Hectares</div>
        <div style={{ color: '#4ade80', fontSize: 18, fontFamily: 'monospace', fontWeight: 700 }}>
          {fyHa.toLocaleString('en-AU', { maximumFractionDigits: 1 })}
          <span style={{ fontSize: 10, color: '#3a5a3a', marginLeft: 4 }}>ha</span>
        </div>
      </div>
    </div>
  )
}

// ── Not Configured ────────────────────────────────────────────────────────────

function NotConfigured() {
  return (
    <div style={{ background: '#0a0e0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ fontFamily: 'monospace', color: '#d97706', fontSize: 18, letterSpacing: 3, marginBottom: 16 }}>HQP DRONE OPS</div>
        <div style={{ background: '#111711', border: '1px solid #2a3a1a', borderRadius: 6, padding: 24 }}>
          <div style={{ color: '#f87171', fontSize: 12, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 12 }}>⚠ SUPABASE NOT CONFIGURED</div>
          <pre style={{ background: '#0a0e0a', border: '1px solid #1e2e1e', borderRadius: 4, padding: 12, color: '#c8dcc8', fontSize: 11, textAlign: 'left' }}>
{`VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}
          </pre>
          <p style={{ marginTop: 12, color: '#4a6a4a', fontFamily: 'monospace', fontSize: 11 }}>See DEPLOY.md for setup instructions.</p>
        </div>
      </div>
    </div>
  )
}

// ── PIN Modal ─────────────────────────────────────────────────────────────────

function PinModal({ onSuccess, onCancel }) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const refs = [useRef(), useRef(), useRef(), useRef()]

  useEffect(() => { setTimeout(() => refs[0].current?.focus(), 100) }, [])

  function handleChange(i, e) {
    const v = e.target.value.replace(/\D/g, '').slice(-1)
    const nd = [...digits]; nd[i] = v; setDigits(nd); setError(false)
    if (v && i < 3) refs[i + 1].current.focus()
    if (i === 3 && v) {
      if (nd.join('') === getPin()) { onSuccess() }
      else { setError(true); setDigits(['', '', '', '']); setTimeout(() => refs[0].current?.focus(), 50) }
    }
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs[i - 1].current.focus()
  }

  return (
    <ModalWrap>
      <div style={{ background: '#0c100c', border: '1px solid #243424', borderRadius: 6, width: 300, boxShadow: '0 24px 60px rgba(0,0,0,0.9)', marginTop: 80 }}>
        <div style={{ padding: '22px 18px 18px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'monospace', color: '#d97706', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Operations Access</div>
          <div style={{ fontFamily: 'monospace', color: '#2a4a2a', fontSize: 10, marginBottom: 22 }}>Enter PIN to continue</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 }}>
            {digits.map((d, i) => (
              <input key={i} ref={refs[i]} type="password" inputMode="numeric" maxLength={1} value={d}
                onChange={e => handleChange(i, e)} onKeyDown={e => handleKeyDown(i, e)}
                style={{ width: 46, height: 52, background: '#080d08', border: `1px solid ${error ? '#f87171' : '#243424'}`, borderRadius: 4, color: error ? '#f87171' : '#c8dcc8', textAlign: 'center', fontSize: 24, fontFamily: 'monospace', outline: 'none' }} />
            ))}
          </div>
          {error && <div style={{ color: '#f87171', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 12 }}>INCORRECT PIN</div>}
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#3a5a3a', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>← Cancel</button>
        </div>
      </div>
    </ModalWrap>
  )
}

// ── Settings Modal ────────────────────────────────────────────────────────────

function SettingsModal({ onClose }) {
  const s = getSettings()
  const [email, setEmail]         = useState(s.notifyEmail || '')
  const [newPin, setNewPin]       = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinErr, setPinErr]       = useState('')
  const [pinOk, setPinOk]         = useState(false)
  const [emailOk, setEmailOk]     = useState(false)

  function saveEmail() {
    saveSettings({ ...getSettings(), notifyEmail: email })
    setEmailOk(true); setTimeout(() => setEmailOk(false), 2000)
  }

  function changePin() {
    setPinErr(''); setPinOk(false)
    if (!/^\d{4}$/.test(newPin)) { setPinErr('PIN must be exactly 4 digits'); return }
    if (newPin !== confirmPin)   { setPinErr('PINs do not match'); return }
    saveSettings({ ...getSettings(), pin: newPin })
    setNewPin(''); setConfirmPin(''); setPinOk(true)
  }

  return (
    <ModalBox title="Settings" onClose={onClose} maxW={500}>
      <div style={{ background: '#080d08', border: '1px solid #1a2a1a', borderRadius: 4, padding: 14, marginBottom: 14 }}>
        <div style={{ color: '#d97706', fontSize: 9, letterSpacing: 2, fontFamily: 'monospace', textTransform: 'uppercase', marginBottom: 12 }}>Email Notifications</div>
        <FF label="Notification email" hint="A pre-filled email opens in your mail client when HQ Plantations books a new job">
          <div style={{ display: 'flex', gap: 8 }}>
            <Inp value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            <Btn sm onClick={saveEmail}>{emailOk ? 'Saved ✓' : 'Save'}</Btn>
          </div>
        </FF>
      </div>
      <div style={{ background: '#080d08', border: '1px solid #1a2a1a', borderRadius: 4, padding: 14 }}>
        <div style={{ color: '#d97706', fontSize: 9, letterSpacing: 2, fontFamily: 'monospace', textTransform: 'uppercase', marginBottom: 12 }}>Change Operations PIN</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FF label="New PIN (4 digits)">
            <Inp type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" />
          </FF>
          <FF label="Confirm PIN">
            <Inp type="password" inputMode="numeric" maxLength={4} value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" />
          </FF>
        </div>
        {pinErr && <div style={{ color: '#f87171', fontSize: 10, fontFamily: 'monospace', marginBottom: 8 }}>{pinErr}</div>}
        {pinOk  && <div style={{ color: '#4ade80', fontSize: 10, fontFamily: 'monospace', marginBottom: 8 }}>PIN updated successfully.</div>}
        <Btn sm onClick={changePin}>Update PIN</Btn>
        <div style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace', marginTop: 10 }}>Default PIN is 1234 — change before sharing the URL.</div>
      </div>
    </ModalBox>
  )
}

// ── Booking Modal ─────────────────────────────────────────────────────────────

function BookingModal({ onClose, onSubmit }) {
  const [f, setF] = useState({ area: '', description: '', targetDate: '', notes: '', contactName: '', contactEmail: '', priority: 'medium', hectares: '' })
  const [areaFile, setAreaFile] = useState(null)
  const [opsFile,  setOpsFile]  = useState(null)
  const [saving, setSaving]     = useState(false)
  const upd = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  async function submit() {
    if (!f.area || !f.targetDate) return
    setSaving(true)
    try {
      await onSubmit(f, areaFile, opsFile)
      const email = getNotifyEmail()
      if (email) {
        const pri = PRIORITY[f.priority] || PRIORITY.medium
        const subj = encodeURIComponent(`[${pri.label.toUpperCase()}] New Drone Job — ${f.area}`)
        const body = encodeURIComponent(
          `New job request via HQP Drone Ops.\n\n` +
          `Priority: ${pri.label}\n` +
          `Area / Block: ${f.area}\n` +
          `Estimated Hectares: ${f.hectares || '—'}\n` +
          `Target Completion: ${fmtDate(f.targetDate)}\n` +
          `Contact: ${f.contactName || '—'}${f.contactEmail ? ' <' + f.contactEmail + '>' : ''}\n` +
          `Description: ${f.description || '—'}\n` +
          `Notes: ${f.notes || '—'}\n` +
          `Area File: ${areaFile?.name || 'Not uploaded'}\n` +
          `Ops Plan: ${opsFile?.name || 'Not uploaded'}`
        )
        window.open(`mailto:${email}?subject=${subj}&body=${body}`, '_blank')
      }
    } finally { setSaving(false) }
  }

  return (
    <ModalBox title="Book a Drone Job — HQ Plantations" onClose={onClose} maxW={700}>
      {/* Priority selector */}
      <FF label="Priority *">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
          {Object.entries(PRIORITY).map(([k, v]) => (
            <button key={k} onClick={() => setF(p => ({ ...p, priority: k }))}
              style={{ background: f.priority === k ? v.bg : 'transparent', color: f.priority === k ? v.clr : '#3a5a3a', border: `1px solid ${f.priority === k ? v.clr + '80' : '#1e2e1e'}`, padding: '7px 4px', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
              <div style={{ fontSize: 12, marginBottom: 2 }}>{v.symbol}</div>
              {v.label}
            </button>
          ))}
        </div>
      </FF>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FF label="Area / Block Name *"><Inp value={f.area} onChange={upd('area')} placeholder="e.g. Block 14A — Pine Creek" /></FF>
        <FF label="Target Completion Date *"><Inp type="date" value={f.targetDate} onChange={upd('targetDate')} /></FF>
        <FF label="Estimated Hectares"><Inp type="number" value={f.hectares} onChange={upd('hectares')} placeholder="e.g. 125.5" /></FF>
        <FF label="Contact Name"><Inp value={f.contactName} onChange={upd('contactName')} placeholder="Your name" /></FF>
        <FF label="Contact Email"><Inp type="email" value={f.contactEmail} onChange={upd('contactEmail')} placeholder="you@hqplantations.com.au" /></FF>
      </div>

      <FF label="Job Description"><Txta value={f.description} onChange={upd('description')} placeholder="Describe the work — species, age, treatment type, access details..." /></FF>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FF label="Area File" hint="Shapefile (.shp, .zip) or KML (.kml)">
          <FileBtn label="Upload .shp / .zip / .kml" accept=".shp,.dbf,.shx,.prj,.zip,.kml,.kmz" onChange={e => setAreaFile(e.target.files[0] || null)} done={areaFile?.name} />
        </FF>
        <FF label="Ops Plan" hint="Operations plan (PDF or Word)">
          <FileBtn label="Upload ops plan" accept=".pdf,.doc,.docx" onChange={e => setOpsFile(e.target.files[0] || null)} done={opsFile?.name} />
        </FF>
      </div>

      <FF label="Additional Notes"><Txta value={f.notes} onChange={upd('notes')} placeholder="Gate codes, hazards, special requirements, preferred flight window..." style={{ minHeight: 50 }} /></FF>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid #1a2a1a', marginTop: 4 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={!f.area || !f.targetDate || saving}>{saving ? 'Submitting...' : 'Submit Job Request'}</Btn>
      </div>
    </ModalBox>
  )
}

// ── Records Modal ─────────────────────────────────────────────────────────────

const KFIELDS = [
  ['temp', 'Temp', '°C'], ['windSpeed', 'Wind Speed', 'km/h'],
  ['windDir', 'Wind Dir', '°'], ['humidity', 'Humidity', '%'],
  ['dewPoint', 'Dew Point', '°C'], ['densAlt', 'Density Alt', 'ft'],
]

function RecordsModal({ job, onClose, onSave }) {
  const [tab,     setTab]     = useState('upload')
  const [kmlFile, setKmlFile] = useState(null)
  const [imgFile, setImgFile] = useState(null)
  const [opsFile, setOpsFile] = useState(null)
  const [kst, setKst] = useState({ temp: '', windSpeed: '', windDir: '', humidity: '', dewPoint: '', densAlt: '', time: '', notes: '' })
  const [existing,       setExisting]       = useState({})
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [csvStatus,      setCsvStatus]      = useState('')
  const upK = k => e => setKst(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => { if (tab === 'view') loadExisting() }, [tab])

  async function loadExisting() {
    setLoadingExisting(true)
    const ex = {}
    if (job.kml_flight_name) ex.kmlText = await downloadText(P.kmlFlight(job.id))
    if (job.screenshot_name) ex.imgUrl  = publicUrl(P.screenshot(job.id, job.screenshot_name))
    ex.hasOps   = !!job.ops_completed_name
    ex.kestrel  = job.kestrel || null
    setExisting(ex)
    setLoadingExisting(false)
  }

  async function handleKestrelCSV(e) {
    const file = e.target.files[0]; if (!file) return
    const text = await file.text()
    const parsed = parseKestrelCSV(text)
    if (parsed) {
      setKst(parsed)
      setCsvStatus('✓ Kestrel CSV imported — check values below')
    } else {
      setCsvStatus('⚠ Could not parse CSV — please fill in manually')
    }
  }

  async function save() {
    setSaving(true)
    try { await onSave(job.id, kmlFile, imgFile, opsFile, Object.values(kst).some(v => v) ? kst : null) }
    finally { setSaving(false) }
  }

  async function downloadOps() {
    triggerDownload(publicUrl(P.opsCompleted(job.id, job.ops_completed_name)), job.ops_completed_name)
  }

  return (
    <ModalBox title={`Records — ${job.area}`} onClose={onClose} maxW={740}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #1a2a1a' }}>
        {['upload', 'view'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? '#d97706' : 'transparent', color: tab === t ? '#0c100c' : '#4a6a4a', border: `1px solid ${tab === t ? '#d97706' : '#1e2e1e'}`, padding: '4px 14px', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
            {t === 'upload' ? '⬆ Upload Records' : '⬇ View / Download'}
          </button>
        ))}
      </div>

      {tab === 'upload' && <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <FF label="Flight Lines KML" hint="From flight controller">
            <FileBtn label="Upload .kml / .kmz" accept=".kml,.kmz" onChange={e => setKmlFile(e.target.files[0] || null)} done={kmlFile?.name || (job.kml_flight_name ? '✓ On file' : '')} />
          </FF>
          <FF label="GE Pro Screenshot" hint="Screenshot of flight lines">
            <FileBtn label="Upload .png / .jpg" accept=".png,.jpg,.jpeg" onChange={e => setImgFile(e.target.files[0] || null)} done={imgFile?.name || (job.screenshot_name ? '✓ On file' : '')} />
          </FF>
          <FF label="Completed Ops Plan" hint="Signed / completed plan">
            <FileBtn label="Upload .pdf / .docx" accept=".pdf,.doc,.docx" onChange={e => setOpsFile(e.target.files[0] || null)} done={opsFile?.name || (job.ops_completed_name ? '✓ On file' : '')} />
          </FF>
        </div>

        {/* Kestrel section */}
        <div style={{ border: '1px solid #1a2a1a', borderRadius: 4, padding: 14, marginTop: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ color: '#d97706', fontSize: 9, letterSpacing: 2, fontFamily: 'monospace', textTransform: 'uppercase' }}>Kestrel Readings</div>
            <div>
              <label style={{ display: 'inline-block', border: '1px solid #2a4a3a', background: '#031a0c', color: '#4ade80', padding: '4px 10px', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                ⬆ Import CSV
                <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleKestrelCSV} />
              </label>
            </div>
          </div>
          {csvStatus && (
            <div style={{ color: csvStatus.startsWith('✓') ? '#4ade80' : '#f97316', fontSize: 10, fontFamily: 'monospace', marginBottom: 10 }}>{csvStatus}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {KFIELDS.map(([k, label, unit]) => (
              <FF key={k} label={`${label} (${unit})`}><Inp type="number" value={kst[k]} onChange={upK(k)} placeholder="—" style={{ padding: '6px 8px' }} /></FF>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <FF label="Reading Time"><Inp type="time" value={kst.time} onChange={upK('time')} /></FF>
            <FF label="Conditions Notes"><Inp value={kst.notes} onChange={upK('notes')} placeholder="Any notable conditions..." /></FF>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="green" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Records & Mark Complete'}</Btn>
        </div>
      </>}

      {tab === 'view' && (
        loadingExisting
          ? <div style={{ color: '#3a5a3a', fontFamily: 'monospace', fontSize: 11, padding: 32, textAlign: 'center' }}>Loading records...</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!existing.kmlText && !existing.imgUrl && !existing.hasOps && !existing.kestrel && (
                <div style={{ color: '#2a4a2a', fontFamily: 'monospace', fontSize: 12, padding: 36, textAlign: 'center' }}>No completion records uploaded yet.</div>
              )}
              {existing.kmlText && (
                <div style={{ background: '#080d08', border: '1px solid #1a2a1a', borderRadius: 4, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#c8dcc8', fontSize: 12, fontFamily: 'monospace' }}>Flight Lines KML</div>
                    <div style={{ color: '#2a4a2a', fontSize: 10, marginTop: 2 }}>{job.kml_flight_name}</div>
                  </div>
                  <Btn sm variant="ghost" onClick={() => {
                    const blob = new Blob([existing.kmlText], { type: 'application/vnd.google-earth.kml+xml' })
                    triggerDownload(URL.createObjectURL(blob), job.kml_flight_name || `${job.area}_flight.kml`)
                  }}>⬇ Download</Btn>
                </div>
              )}
              {existing.imgUrl && (
                <div style={{ background: '#080d08', border: '1px solid #1a2a1a', borderRadius: 4, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ color: '#c8dcc8', fontSize: 12, fontFamily: 'monospace' }}>Google Earth Pro Screenshot</div>
                    <Btn sm variant="ghost" onClick={() => triggerDownload(existing.imgUrl, job.screenshot_name)}>⬇ Download</Btn>
                  </div>
                  <img src={existing.imgUrl} alt="GE Screenshot" style={{ width: '100%', borderRadius: 4, border: '1px solid #1a2a1a' }} />
                </div>
              )}
              {existing.hasOps && (
                <div style={{ background: '#080d08', border: '1px solid #1a2a1a', borderRadius: 4, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ color: '#c8dcc8', fontSize: 12, fontFamily: 'monospace' }}>Completed Ops Plan — {job.ops_completed_name}</div>
                  <Btn sm variant="ghost" onClick={downloadOps}>⬇ Download</Btn>
                </div>
              )}
              {existing.kestrel && (
                <div style={{ background: '#080d08', border: '1px solid #1a2a1a', borderRadius: 4, padding: 14 }}>
                  <div style={{ color: '#c8dcc8', fontSize: 12, fontFamily: 'monospace', marginBottom: 12 }}>Kestrel Readings</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                    {KFIELDS.filter(([k]) => existing.kestrel[k]).map(([k, label, unit]) => (
                      <div key={k} style={{ background: '#0c100c', border: '1px solid #1a2a1a', borderRadius: 3, padding: '8px 10px' }}>
                        <div style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                        <div style={{ color: '#d97706', fontSize: 22, fontFamily: 'monospace', fontWeight: 700, marginTop: 2, lineHeight: 1 }}>
                          {existing.kestrel[k]}<span style={{ fontSize: 10, color: '#4a6a4a' }}> {unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {existing.kestrel.time  && <div style={{ color: '#4a6a4a', fontSize: 10, marginTop: 10, fontFamily: 'monospace' }}>Time: {existing.kestrel.time}</div>}
                  {existing.kestrel.notes && <div style={{ color: '#5a7a5a', fontSize: 11, marginTop: 4, fontFamily: 'monospace' }}>Notes: {existing.kestrel.notes}</div>}
                </div>
              )}
            </div>
      )}
    </ModalBox>
  )
}

// ── Job Detail Modal ──────────────────────────────────────────────────────────

function JobDetailModal({ job, isOps, onClose, onStatusChange }) {
  const Row = ({ label, value }) => value ? (
    <div style={{ display: 'flex', padding: '6px 0', borderBottom: '1px solid #0d140d' }}>
      <div style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, width: 130, flexShrink: 0, paddingTop: 1 }}>{label}</div>
      <div style={{ color: '#a8c8a8', fontSize: 12, fontFamily: 'monospace', flex: 1, wordBreak: 'break-word' }}>{value}</div>
    </div>
  ) : null

  async function downloadAreaFile() {
    const url = publicUrl(P.kmlBooking(job.id))
    triggerDownload(url, job.kml_booking_name)
  }

  async function downloadBookingOps() {
    triggerDownload(publicUrl(P.opsBooking(job.id, job.ops_booking_name)), job.ops_booking_name)
  }

  return (
    <ModalBox title={`Job ${job.id}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Badge s={job.status} />
        <PriBadge p={job.priority || 'medium'} />
      </div>
      <Row label="Area"        value={job.area} />
      <Row label="Hectares"    value={job.hectares ? `${job.hectares} ha` : null} />
      <Row label="Description" value={job.description} />
      <Row label="Contact"     value={[job.contact_name, job.contact_email].filter(Boolean).join(' — ')} />
      <Row label="Target Date" value={fmtDate(job.target_date)} />
      <Row label="Submitted"   value={fmtTs(job.created_at)} />
      {job.completed_at && <Row label="Completed" value={fmtTs(job.completed_at)} />}
      <Row label="Notes"       value={job.notes} />
      <Row label="Area File"   value={job.kml_booking_name} />
      <Row label="Booking Ops" value={job.ops_booking_name} />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {job.kml_booking_name && <Btn sm variant="ghost" onClick={downloadAreaFile}>⬇ Area File</Btn>}
        {job.ops_booking_name && <Btn sm variant="ghost" onClick={downloadBookingOps}>⬇ Ops Plan</Btn>}
      </div>

      {isOps && job.status !== 'cancelled' && (
        <div style={{ marginTop: 16, borderTop: '1px solid #1a2a1a', paddingTop: 14 }}>
          <div style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Update Status</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(STATUS).filter(([k]) => k !== job.status).map(([k, v]) => (
              <button key={k} onClick={() => onStatusChange(job.id, k)} style={{ background: v.bg, color: v.clr, border: `1px solid ${v.clr}55`, padding: '4px 12px', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                → {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </ModalBox>
  )
}

// ── Search / Filter ───────────────────────────────────────────────────────────

function FilterBar({ search, setSearch, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter }) {
  const hasFilter = search || statusFilter || priorityFilter
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#2a4a2a', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
        <Inp value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by area name..." style={{ paddingLeft: 28 }} />
      </div>
      <div style={{ width: 140 }}>
        <Sel value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Sel>
      </div>
      <div style={{ width: 130 }}>
        <Sel value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.symbol} {v.label}</option>)}
        </Sel>
      </div>
      {hasFilter && (
        <button onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter('') }} style={{ background: 'none', border: 'none', color: '#3a5a3a', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap', padding: '7px 4px' }}>
          ✕ Clear
        </button>
      )}
    </div>
  )
}

function useFilter(jobs) {
  const [search,         setSearch]         = useState('')
  const [statusFilter,   setStatusFilter]   = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const filtered = jobs.filter(j => {
    const matchSearch   = !search         || j.area.toLowerCase().includes(search.toLowerCase()) || (j.description || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus   = !statusFilter   || j.status === statusFilter
    const matchPriority = !priorityFilter || (j.priority || 'medium') === priorityFilter
    return matchSearch && matchStatus && matchPriority
  })
  return { search, setSearch, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, filtered }
}

// ── Job Table ─────────────────────────────────────────────────────────────────

function JobTable({ title, jobs, onRow, emptyMsg, style }) {
  return (
    <div style={{ background: '#0e140e', border: '1px solid #1a2a1a', borderRadius: 5, ...style }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a2a1a', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'monospace', color: '#d97706', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace' }}>{jobs.length}</span>
      </div>
      {jobs.length === 0
        ? <div style={{ padding: 28, textAlign: 'center', color: '#2a4a2a', fontFamily: 'monospace', fontSize: 11 }}>{emptyMsg}</div>
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2a1a' }}>
                  {['Job ID', 'Priority', 'Area', 'Ha', 'Status', 'Target', 'Records'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', color: '#2a4a2a', fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'left', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #0a100a', cursor: 'pointer' }} onClick={() => onRow(j)}>
                    <td style={{ padding: '8px 12px', color: '#d97706', fontSize: 10, fontFamily: 'monospace' }}>{j.id}</td>
                    <td style={{ padding: '8px 12px' }}><PriBadge p={j.priority || 'medium'} /></td>
                    <td style={{ padding: '8px 12px', color: '#c8dcc8', fontSize: 11, fontFamily: 'monospace', maxWidth: 160 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.area}</div>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#5a7a5a', fontSize: 10, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{j.hectares || '—'}</td>
                    <td style={{ padding: '8px 12px' }}><Badge s={j.status} /></td>
                    <td style={{ padding: '8px 12px', color: '#5a7a5a', fontSize: 10, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtDate(j.target_date)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 10, fontFamily: 'monospace' }}>
                      <span style={{ color: '#4ade80' }}>{j.kml_flight_name ? 'KML ' : ''}</span>
                      <span style={{ color: '#60a5fa' }}>{j.screenshot_name ? 'IMG ' : ''}</span>
                      <span style={{ color: '#d97706' }}>{j.kestrel ? 'KEST ' : ''}</span>
                      <span style={{ color: '#a78bfa' }}>{j.ops_completed_name ? 'OPS' : ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  )
}

// ── Portal View ───────────────────────────────────────────────────────────────

function PortalView({ jobs, onBook, onView }) {
  const { search, setSearch, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, filtered } = useFilter(jobs)
  const active = filtered.filter(j => !['completed', 'cancelled'].includes(j.status))
  const past   = filtered.filter(j =>  ['completed', 'cancelled'].includes(j.status))
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 3, color: '#d4e8d4', fontWeight: 700 }}>HQ PLANTATIONS</div>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#2a4a2a', letterSpacing: 2, marginTop: 3 }}>DRONE OPERATIONS CLIENT PORTAL</div>
        </div>
        <Btn onClick={onBook}>+ Book New Job</Btn>
      </div>
      <PrioritySummary jobs={jobs} />
      <FilterBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} />
      <JobTable title="Active Jobs" jobs={active} onRow={onView} emptyMsg={search || statusFilter || priorityFilter ? 'No jobs match your filter' : 'No active jobs — book one above'} />
      {past.length > 0 && <JobTable title="Completed & Past" jobs={past} onRow={onView} style={{ marginTop: 18 }} />}
    </div>
  )
}

// ── Ops View ──────────────────────────────────────────────────────────────────

function OpsView({ jobs, onView, onRecords, onSettings }) {
  const { search, setSearch, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, filtered } = useFilter(jobs)
  const stats = [
    { label: 'Total',   val: jobs.length,                                                           clr: '#d4e8d4' },
    { label: 'Pending', val: jobs.filter(j => j.status === 'pending').length,                       clr: '#d97706' },
    { label: 'Active',  val: jobs.filter(j => ['scheduled', 'in-progress'].includes(j.status)).length, clr: '#a78bfa' },
    { label: 'Done',    val: jobs.filter(j => j.status === 'completed').length,                     clr: '#4ade80' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 3, color: '#d4e8d4', fontWeight: 700 }}>OPERATIONS</div>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#2a4a2a', letterSpacing: 2, marginTop: 3 }}>JOB MANAGEMENT & COMPLETION RECORDS</div>
        </div>
        <Btn variant="ghost" sm onClick={onSettings}>⚙ Settings</Btn>
      </div>

      <PrioritySummary jobs={jobs} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: '#0e140e', border: '1px solid #1a2a1a', borderRadius: 5, padding: '11px 14px' }}>
            <div style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1.5 }}>{s.label}</div>
            <div style={{ color: s.clr, fontSize: 30, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1.1, marginTop: 5 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <FilterBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} />

      <div style={{ background: '#0e140e', border: '1px solid #1a2a1a', borderRadius: 5 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a2a1a', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'monospace', color: '#d97706', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>All Jobs</span>
          <span style={{ color: '#2a4a2a', fontSize: 9, fontFamily: 'monospace' }}>{filtered.length}{filtered.length !== jobs.length ? ` of ${jobs.length}` : ''} total</span>
        </div>
        {jobs.length === 0
          ? <div style={{ padding: 40, textAlign: 'center', color: '#2a4a2a', fontFamily: 'monospace', fontSize: 11 }}>No jobs yet — they appear here when booked via the Client Portal.</div>
          : filtered.length === 0
          ? <div style={{ padding: 32, textAlign: 'center', color: '#2a4a2a', fontFamily: 'monospace', fontSize: 11 }}>No jobs match your search / filter.</div>
          : <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1a2a1a' }}>
                    {['Job ID', 'Priority', 'Area', 'Ha', 'Status', 'Target', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '7px 12px', color: '#2a4a2a', fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'left', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => (
                    <tr key={j.id} style={{ borderBottom: '1px solid #0a100a' }}>
                      <td style={{ padding: '8px 12px', color: '#d97706', fontSize: 10, fontFamily: 'monospace' }}>{j.id}</td>
                      <td style={{ padding: '8px 12px' }}><PriBadge p={j.priority || 'medium'} /></td>
                      <td style={{ padding: '8px 12px', color: '#c8dcc8', fontSize: 11, fontFamily: 'monospace', maxWidth: 160 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.area}</div>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#5a7a5a', fontSize: 10, fontFamily: 'monospace' }}>{j.hectares || '—'}</td>
                      <td style={{ padding: '8px 12px' }}><Badge s={j.status} /></td>
                      <td style={{ padding: '8px 12px', color: '#5a7a5a', fontSize: 10, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtDate(j.target_date)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <Btn sm variant="ghost" onClick={() => onView(j)}>View</Btn>
                          {j.status !== 'cancelled' && <Btn sm variant="green" onClick={() => onRecords(j)}>Records</Btn>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        }
      </div>
    </div>
  )
}

// ── App Root ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view,    setView]    = useState('portal')
  const [opsAuth, setOpsAuth] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [jobs,    setJobs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [modal,   setModal]   = useState(null)

  if (!isConfigured) return <NotConfigured />

  useEffect(() => {
    loadJobs()
    const channel = supabase
      .channel('jobs_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => loadJobs())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function loadJobs() {
    const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false })
    if (error) { setError(error.message); setLoading(false); return }
    setJobs(data || [])
    setLoading(false)
  }

  async function addJob(formData, areaFile, opsFile) {
    const id = genId()
    const job = {
      id, status: 'pending',
      priority:      formData.priority || 'medium',
      hectares:      formData.hectares ? parseFloat(formData.hectares) : null,
      area:          formData.area,
      description:   formData.description,
      target_date:   formData.targetDate,
      notes:         formData.notes,
      contact_name:  formData.contactName,
      contact_email: formData.contactEmail,
      kml_booking_name: areaFile?.name || null,
      ops_booking_name: opsFile?.name  || null,
    }
    const { error } = await supabase.from('jobs').insert(job)
    if (error) { alert('Error saving job: ' + error.message); return }
    if (areaFile) await upload(P.kmlBooking(id), areaFile)
    if (opsFile)  await upload(P.opsBooking(id, opsFile.name), opsFile)
    await loadJobs()
    setModal(null)
  }

  async function updateStatus(id, status) {
    await supabase.from('jobs').update({ status }).eq('id', id)
    await loadJobs()
    setModal(null)
  }

  async function saveRecords(jobId, kmlFile, imgFile, opsFile, kestrel) {
    const updates = { status: 'completed', completed_at: new Date().toISOString() }
    if (kmlFile) { await upload(P.kmlFlight(jobId), kmlFile); updates.kml_flight_name = kmlFile.name }
    if (imgFile) { await upload(P.screenshot(jobId, imgFile.name), imgFile); updates.screenshot_name = imgFile.name }
    if (opsFile) { await upload(P.opsCompleted(jobId, opsFile.name), opsFile); updates.ops_completed_name = opsFile.name }
    if (kestrel) { updates.kestrel = kestrel }
    await supabase.from('jobs').update(updates).eq('id', jobId)
    await loadJobs()
    setModal(null)
  }

  if (loading) return (
    <div style={{ background: '#0a0e0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'monospace', color: '#d97706', letterSpacing: 4, fontSize: 11 }}>LOADING HQP OPS SYSTEM...</div>
    </div>
  )

  if (error) return (
    <div style={{ background: '#0a0e0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ color: '#f87171', fontFamily: 'monospace', fontSize: 12, maxWidth: 500, textAlign: 'center' }}>
        <div style={{ fontSize: 14, marginBottom: 12 }}>DATABASE ERROR</div>
        <div>{error}</div>
        <div style={{ marginTop: 12, color: '#4a6a4a' }}>Check your Supabase config and that migration.sql has been run.</div>
      </div>
    </div>
  )

  return (
    <div style={{ background: '#0a0e0a', minHeight: '100vh', color: '#d4e8d4' }}>
      <div style={{ borderBottom: '1px solid #1a2a1a', padding: '11px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#080d08', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3.5" stroke="#d97706" strokeWidth="1.5" />
            {[[12,2,12,7],[12,17,12,22],[2,12,7,12],[17,12,22,12]].map(([x1,y1,x2,y2],i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d97706" strokeWidth="1.5" />
            ))}
            {[[12,2],[12,22],[2,12],[22,12]].map(([cx,cy],i) => (
              <circle key={i} cx={cx} cy={cy} r="2" stroke="#d97706" strokeWidth="1.5" fill="none" />
            ))}
          </svg>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 3, color: '#d4e8d4', fontWeight: 700 }}>HQP DRONE OPS</div>
            <div style={{ fontFamily: 'monospace', fontSize: 7, color: '#2a4a2a', letterSpacing: 2, marginTop: 1 }}>FLIGHT MANAGEMENT SYSTEM v1.2</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['portal', 'ops'].map(v => (
            <button key={v} onClick={() => v === 'ops' ? (opsAuth ? setView('ops') : setShowPin(true)) : setView('portal')}
              style={{ background: view === v ? '#142014' : 'transparent', color: view === v ? '#4ade80' : '#3a5a3a', border: `1px solid ${view === v ? '#2a4a2a' : '#1a2a1a'}`, padding: '5px 14px', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
              {v === 'ops' && !opsAuth && <span style={{ fontSize: 10 }}>🔒</span>}
              {v === 'portal' ? '◈ Client Portal' : '◈ Operations'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '22px', maxWidth: 1100, margin: '0 auto' }}>
        {view === 'portal'
          ? <PortalView jobs={jobs} onBook={() => setModal('book')} onView={j => setModal({ type: 'detail', job: j })} />
          : <OpsView jobs={jobs} onView={j => setModal({ type: 'detail', job: j })} onRecords={j => setModal({ type: 'records', job: j })} onSettings={() => setModal('settings')} />
        }
      </div>

      {showPin && <PinModal onSuccess={() => { setOpsAuth(true); setView('ops'); setShowPin(false) }} onCancel={() => setShowPin(false)} />}

      {modal === 'book'     && <BookingModal onClose={() => setModal(null)} onSubmit={addJob} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal?.type === 'detail'  && <JobDetailModal job={modal.job} isOps={view === 'ops'} onClose={() => setModal(null)} onStatusChange={updateStatus} />}
      {modal?.type === 'records' && <RecordsModal job={modal.job} onClose={() => setModal(null)} onSave={saveRecords} />}
    </div>
  )
}
