import { useState, useMemo } from 'react';
import TBar, { TBarFooter } from './TBar';

/* ── Helpers ─────────────────────────────────────────── */

const statusColor = { open: '#c6ffbb', printed: '#fbde42', idle: '#ff6b6b' };

function Card({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: '2px solid',
      borderColor: '#fff #808080 #808080 #fff',
      background: '#c0c0c0',
      marginBottom: 6,
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          background: 'linear-gradient(90deg, #000080, #0000cd)',
          color: '#fff',
          padding: '3px 6px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 'bold',
          fontSize: 11,
        }}
      >
        <span>{title}</span>
        <span>{open ? '−' : '+'}</span>
      </div>
      {open && <div style={{ padding: 6 }}>{children}</div>}
    </div>
  );
}

function CheckTile({ order, selected, onClick }) {
  const bg = statusColor[order.status] || '#c6ffbb';
  return (
    <button
      onClick={onClick}
      style={{
        width: 68,
        height: 68,
        background: selected ? '#000080' : bg,
        color: selected ? '#fff' : '#000',
        border: '2px solid',
        borderColor: selected
          ? '#000080 #000040 #000040 #000080'
          : '#fff #808080 #808080 #fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 'bold',
        cursor: 'pointer',
        padding: 2,
      }}
    >
      <span style={{ fontSize: 11 }}>{order.label || order.id}</span>
      <span style={{ fontSize: 9, opacity: 0.8 }}>
        {order.guest_count}G • {order.total}
      </span>
    </button>
  );
}

/* ── Dialogs ─────────────────────────────────────────── */

function Dialog({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{
        width: 300,
        border: '2px solid',
        borderColor: '#fff #808080 #808080 #fff',
        background: '#c0c0c0',
      }}>
        <div style={{
          background: 'linear-gradient(90deg, #000080, #0000cd)',
          color: '#fff',
          padding: '4px 8px',
          fontWeight: 'bold',
          fontSize: 12,
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>{title}</span>
          <button onClick={onClose} style={{
            background: '#c00020',
            color: '#fff',
            border: 'none',
            width: 20,
            height: 18,
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: 12,
            lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

function NewCheckDialog({ onClose, onConfirm }) {
  const [tableName, setTableName] = useState('');
  const [guests, setGuests] = useState(0);

  return (
    <Dialog title="New Check" onClose={onClose}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          Table Name (optional)
        </label>
        <input
          value={tableName}
          onChange={e => setTableName(e.target.value)}
          style={{
            width: '100%',
            padding: '4px 6px',
            border: '2px solid',
            borderColor: '#808080 #fff #fff #808080',
          }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          Guest Count
        </label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[1,2,3,4,5,6,7,8].map(n => (
            <button
              key={n}
              onClick={() => setGuests(n)}
              style={{
                width: 32,
                height: 28,
                border: '2px solid',
                borderColor: guests === n
                  ? '#000080 #000040 #000040 #000080'
                  : '#fff #808080 #808080 #fff',
                background: guests === n ? '#000080' : '#c0c0c0',
                color: guests === n ? '#fff' : '#000',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <button
        disabled={guests === 0}
        onClick={() => onConfirm({ tableName, guests })}
        style={{
          width: '100%',
          padding: '6px 0',
          background: guests === 0 ? '#808080' : '#000080',
          color: '#fff',
          fontWeight: 'bold',
          border: '2px solid',
          borderColor: '#fff #808080 #808080 #fff',
          cursor: guests === 0 ? 'default' : 'pointer',
        }}
      >
        Confirm
      </button>
    </Dialog>
  );
}

function EditCheckDialog({ order, onClose, onSave }) {
  const [tableName, setTableName] = useState(order.label || '');
  const [guests, setGuests] = useState(order.guest_count);

  return (
    <Dialog title="Edit Check" onClose={onClose}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          Table Name
        </label>
        <input
          value={tableName}
          onChange={e => setTableName(e.target.value)}
          style={{
            width: '100%',
            padding: '4px 6px',
            border: '2px solid',
            borderColor: '#808080 #fff #fff #808080',
          }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          Guest Count
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setGuests(g => Math.max(1, g - 1))}
            style={{
              width: 28, height: 28,
              border: '2px solid',
              borderColor: '#fff #808080 #808080 #fff',
              background: '#c0c0c0',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >−</button>
          <span style={{ fontSize: 14, fontWeight: 'bold', minWidth: 20, textAlign: 'center' }}>
            {guests}
          </span>
          <button
            onClick={() => setGuests(g => Math.min(20, g + 1))}
            style={{
              width: 28, height: 28,
              border: '2px solid',
              borderColor: '#fff #808080 #808080 #fff',
              background: '#c0c0c0',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >+</button>
        </div>
      </div>
      <button
        onClick={() => onSave({ ...order, label: tableName, guest_count: guests })}
        style={{
          width: '100%',
          padding: '6px 0',
          background: '#000080',
          color: '#fff',
          fontWeight: 'bold',
          border: '2px solid',
          borderColor: '#fff #808080 #808080 #fff',
          cursor: 'pointer',
        }}
      >
        Save
      </button>
    </Dialog>
  );
}

/* ── Selection Panel ─────────────────────────────────── */

function SelectionPanel({ count, onAction }) {
  const btnStyle = {
    padding: '6px 12px',
    border: '2px solid',
    borderColor: '#fff #808080 #808080 #fff',
    background: '#c0c0c0',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 11,
  };

  const single = count === 1;
  const multi = count > 1;

  return (
    <div style={{
      position: 'absolute',
      bottom: 36,
      left: 0,
      right: 0,
      background: '#c0c0c0',
      border: '2px solid',
      borderColor: '#fff #808080 #808080 #fff',
      padding: '8px 12px',
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      alignItems: 'center',
      zIndex: 50,
    }}>
      <span style={{ fontWeight: 'bold', marginRight: 8 }}>{count} selected</span>
      {single && (
        <>
          <button style={btnStyle} onClick={() => onAction('open')}>Open Check</button>
          <button style={btnStyle} onClick={() => onAction('edit')}>Edit</button>
          <button style={btnStyle} onClick={() => onAction('print')}>Print</button>
          <button style={btnStyle} onClick={() => onAction('payment')}>Payment</button>
          <button style={btnStyle} onClick={() => onAction('transfer')}>Transfer</button>
          <button style={btnStyle} onClick={() => onAction('void')}>Void</button>
        </>
      )}
      {multi && (
        <>
          <button style={btnStyle} onClick={() => onAction('merge')}>Merge Checks</button>
          <button style={btnStyle} onClick={() => onAction('printAll')}>Print All</button>
          <button style={btnStyle} onClick={() => onAction('closeAll')}>Close All</button>
        </>
      )}
    </div>
  );
}

/* ── Main Screen ─────────────────────────────────────── */

export default function SnapshotScreen({ staff, orders, setOrders, onOpenOrder, onNewOrder, onPayment, onLogout }) {
  const [selected, setSelected] = useState(new Set());
  const [showNewCheck, setShowNewCheck] = useState(false);
  const [editOrder, setEditOrder] = useState(null);

  const myChecks = useMemo(
    () => orders.filter(o => o.server === staff.name),
    [orders, staff.name]
  );
  const floorChecks = useMemo(
    () => orders.filter(o => o.server !== staff.name),
    [orders, staff.name]
  );

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleNewConfirm({ tableName, guests }) {
    const newOrder = {
      id: `ORD-${String(Date.now()).slice(-4)}`,
      label: tableName || `Table ${orders.length + 1}`,
      guest_count: guests,
      server: staff.name,
      status: 'open',
      items: [],
      total: '$0.00',
      elapsed: '0:00',
    };
    setShowNewCheck(false);
    onNewOrder(newOrder);
  }

  function handleEditSave(updated) {
    setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    setEditOrder(null);
  }

  function handleAction(action) {
    const ids = [...selected];
    if (action === 'open' && ids.length === 1) {
      const order = orders.find(o => o.id === ids[0]);
      if (order) onOpenOrder(order);
    } else if (action === 'edit' && ids.length === 1) {
      const order = orders.find(o => o.id === ids[0]);
      if (order) setEditOrder(order);
    } else if (action === 'payment' && ids.length === 1) {
      const order = orders.find(o => o.id === ids[0]);
      if (order) onPayment(order);
    } else if (action === 'void' && ids.length === 1) {
      setOrders(prev => prev.filter(o => o.id !== ids[0]));
      setSelected(new Set());
    } else if (action === 'closeAll') {
      setOrders(prev => prev.filter(o => !selected.has(o.id)));
      setSelected(new Set());
    }
  }

  const isServer = staff.role === 'server';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <TBar staff={staff} onLogout={onLogout} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar */}
        <div style={{ width: 180, padding: 6, overflowY: 'auto', flexShrink: 0 }}>
          {isServer ? (
            <>
              <Card title="Shift Overview" defaultOpen>
                <div style={{ fontSize: 10 }}>
                  <div>Checks: {myChecks.length}</div>
                  <div>Active: {myChecks.filter(o => o.status === 'open').length}</div>
                </div>
              </Card>
              <Card title="Messenger">
                <div style={{ fontSize: 10, color: '#808080' }}>No messages</div>
              </Card>
            </>
          ) : (
            <>
              <Card title="Menu Configuration" defaultOpen>
                <div style={{ fontSize: 10, color: '#808080' }}>Coming soon</div>
              </Card>
              <Card title="Labor Reporting">
                <div style={{ fontSize: 10, color: '#808080' }}>Coming soon</div>
              </Card>
            </>
          )}
        </div>

        {/* Center — Check Grid */}
        <div style={{
          flex: 1,
          padding: 8,
          overflowY: 'auto',
          border: '2px solid',
          borderColor: '#808080 #fff #fff #808080',
          background: '#fff',
          margin: 4,
        }}>
          {/* My Checks */}
          <div style={{ marginBottom: 12 }}>
            <div style={{
              fontWeight: 'bold',
              fontSize: 11,
              marginBottom: 6,
              borderBottom: '1px solid #808080',
              paddingBottom: 3,
            }}>
              My Checks
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {myChecks.map(o => (
                <CheckTile
                  key={o.id}
                  order={o}
                  selected={selected.has(o.id)}
                  onClick={() => toggleSelect(o.id)}
                />
              ))}
              {/* New check button */}
              <button
                onClick={() => setShowNewCheck(true)}
                style={{
                  width: 68,
                  height: 68,
                  border: '2px dashed #808080',
                  background: 'transparent',
                  fontSize: 24,
                  color: '#808080',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ＋
              </button>
            </div>
          </div>

          {/* Floor */}
          <div>
            <div style={{
              fontWeight: 'bold',
              fontSize: 11,
              marginBottom: 6,
              borderBottom: '1px solid #808080',
              paddingBottom: 3,
            }}>
              Floor
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, opacity: 0.6 }}>
              {floorChecks.map(o => (
                <CheckTile
                  key={o.id}
                  order={o}
                  selected={selected.has(o.id)}
                  onClick={() => toggleSelect(o.id)}
                />
              ))}
              {floorChecks.length === 0 && (
                <div style={{ color: '#808080', fontSize: 10, padding: 8 }}>
                  No other checks on the floor
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ width: 180, padding: 6, overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {isServer ? (
            <>
              <Card title="Reporting" defaultOpen>
                <div style={{ fontSize: 10, color: '#808080' }}>View reports</div>
              </Card>
              <Card title="Hardware & Settings">
                <div style={{ fontSize: 10, color: '#808080' }}>Terminal settings</div>
              </Card>
            </>
          ) : (
            <>
              <Card title="Sales Reporting" defaultOpen>
                <div style={{ fontSize: 10, color: '#808080' }}>View sales</div>
              </Card>
              <Card title="Hardware & Settings">
                <div style={{ fontSize: 10, color: '#808080' }}>Terminal settings</div>
              </Card>
              <div style={{ marginTop: 'auto' }}>
                <button style={{
                  width: '100%',
                  padding: '8px 0',
                  background: '#808080',
                  color: '#c0c0c0',
                  fontWeight: 'bold',
                  border: '2px solid',
                  borderColor: '#fff #808080 #808080 #fff',
                  cursor: 'not-allowed',
                  fontSize: 11,
                }} disabled>
                  Close Day
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Selection panel */}
      {selected.size > 0 && (
        <SelectionPanel count={selected.size} onAction={handleAction} />
      )}

      <TBarFooter />

      {/* Dialogs */}
      {showNewCheck && (
        <NewCheckDialog
          onClose={() => setShowNewCheck(false)}
          onConfirm={handleNewConfirm}
        />
      )}
      {editOrder && (
        <EditCheckDialog
          order={editOrder}
          onClose={() => setEditOrder(null)}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
