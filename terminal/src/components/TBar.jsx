import { useState, useEffect } from 'react';

function getGreeting(hour) {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const barStyle = {
  background: 'linear-gradient(180deg, #000080 0%, #0000cd 100%)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  height: 36,
  fontWeight: 'bold',
  fontSize: 12,
  flexShrink: 0,
};

export default function TBar({ staff, onLogout }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {/* Header */}
      <div style={barStyle}>
        <span>{formatDate(now)} — {formatTime(now)}</span>
        <span>
          // {getGreeting(now.getHours())}, {staff.name}{' '}
          <span style={{
            background: staff.role === 'manager' ? '#fbde42' : '#c6ffbb',
            color: '#000',
            padding: '1px 6px',
            borderRadius: 2,
            fontSize: 10,
            marginLeft: 4,
          }}>
            {staff.role}
          </span>
        </span>
        <button
          onClick={onLogout}
          style={{
            background: '#c00020',
            color: '#fff',
            border: 'none',
            width: 28,
            height: 24,
            fontWeight: 'bold',
            fontSize: 14,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </>
  );
}

export function TBarFooter() {
  return (
    <div style={barStyle}>
      <span>T-01 // Vz0.9</span>
      <span>KINDpos</span>
    </div>
  );
}
