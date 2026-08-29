import { useState, useRef, useCallback, useEffect } from 'react';

const API_BASE = '/api/v1';

export default function LoginScreen({ onLogin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const longPressTimer = useRef(null);

  useEffect(() => {
    fetchRoster();
  }, []);

  async function fetchRoster() {
    try {
      const res = await fetch(`${API_BASE}/servers`);
      if (res.ok) {
        const data = await res.json();
        setRoster(data);
      } else {
        // Fallback demo roster
        setRoster(getDemoRoster());
      }
    } catch {
      setRoster(getDemoRoster());
    } finally {
      setLoading(false);
    }
  }

  function getDemoRoster() {
    return [
      { id: 1, name: 'Alex M.', role: 'server', pin: '1234' },
      { id: 2, name: 'Jordan K.', role: 'server', pin: '5678' },
      { id: 3, name: 'Sam R.', role: 'manager', pin: '0000' },
    ];
  }

  const handleDigit = useCallback((d) => {
    setError('');
    setPin(prev => prev.length < 6 ? prev + d : prev);
  }, []);

  const handleClear = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
  }, []);

  const handleClearAll = useCallback(() => {
    setPin('');
    setError('');
  }, []);

  const handleSubmit = useCallback(() => {
    if (!pin) return;
    const match = roster.find(s => s.pin === pin);
    if (match) {
      onLogin(match);
    } else {
      setError('Invalid PIN — try again');
      setPin('');
    }
  }, [pin, roster, onLogin]);

  const handleKeyDown = useCallback((e) => {
    if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
    else if (e.key === 'Backspace') handleClear();
    else if (e.key === 'Enter') handleSubmit();
    else if (e.key === 'Escape') handleClearAll();
  }, [handleDigit, handleClear, handleSubmit, handleClearAll]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const digits = ['1','2','3','4','5','6','7','8','9','CLR','0','>>>'];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: '#c0c0c0',
    }}>
      {/* Login card */}
      <div style={{
        width: 280,
        padding: 20,
        border: '2px solid',
        borderColor: '#fff #808080 #808080 #fff',
        background: '#c0c0c0',
      }}>
        {/* Title bar */}
        <div style={{
          background: 'linear-gradient(90deg, #000080, #0000cd)',
          color: '#fff',
          padding: '4px 8px',
          fontWeight: 'bold',
          fontSize: 12,
          marginBottom: 12,
        }}>
          KINDpos — Server Login
        </div>

        {/* PIN display */}
        <div style={{
          border: '2px solid',
          borderColor: '#808080 #fff #fff #808080',
          background: '#fff',
          padding: '8px 12px',
          marginBottom: 8,
          minHeight: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          letterSpacing: 8,
          fontSize: 18,
        }}>
          {'●'.repeat(pin.length) || '\u00A0'}
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            color: '#c00020',
            textAlign: 'center',
            fontSize: 11,
            marginBottom: 6,
            fontWeight: 'bold',
          }}>
            {error}
          </div>
        )}

        {/* PIN pad */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          marginTop: 8,
        }}>
          {digits.map(d => {
            const isClr = d === 'CLR';
            const isEnter = d === '>>>';
            return (
              <button
                key={d}
                onClick={() => {
                  if (isClr) handleClear();
                  else if (isEnter) handleSubmit();
                  else handleDigit(d);
                }}
                onMouseDown={isClr ? () => {
                  longPressTimer.current = setTimeout(handleClearAll, 600);
                } : undefined}
                onMouseUp={isClr ? () => clearTimeout(longPressTimer.current) : undefined}
                onMouseLeave={isClr ? () => clearTimeout(longPressTimer.current) : undefined}
                style={{
                  height: 44,
                  border: '2px solid',
                  borderColor: '#fff #808080 #808080 #fff',
                  background: isEnter ? '#000080' : '#c0c0c0',
                  color: isEnter ? '#fff' : '#000',
                  fontWeight: 'bold',
                  fontSize: isEnter ? 14 : 16,
                  cursor: 'pointer',
                }}
              >
                {d}
              </button>
            );
          })}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', marginTop: 8, color: '#808080', fontSize: 10 }}>
            Loading roster...
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(180deg, #000080 0%, #0000cd 100%)',
        color: '#fff',
        display: 'flex',
        justifyContent: 'space-between',
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 'bold',
        height: 36,
        alignItems: 'center',
      }}>
        <span>T-01 // Vz0.9</span>
        <span>KINDpos</span>
      </div>
    </div>
  );
}
