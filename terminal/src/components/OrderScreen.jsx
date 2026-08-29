import { useState, useMemo } from 'react';
import TBar, { TBarFooter } from './TBar';

/* ── Demo menu ───────────────────────────────────────── */

const DEMO_MENU = {
  Mains: [
    { id: 'm1', name: 'Burger', price: 12.99 },
    { id: 'm2', name: 'Tacos (3)', price: 10.99 },
    { id: 'm3', name: 'Fish & Chips', price: 14.99 },
    { id: 'm4', name: 'Grilled Chicken', price: 13.49 },
    { id: 'm5', name: 'Pulled Pork', price: 11.99 },
    { id: 'm6', name: 'Veggie Wrap', price: 9.99 },
  ],
  Sides: [
    { id: 's1', name: 'Fries', price: 3.99 },
    { id: 's2', name: 'Coleslaw', price: 2.99 },
    { id: 's3', name: 'Mac & Cheese', price: 4.99 },
    { id: 's4', name: 'Side Salad', price: 3.49 },
  ],
  Drinks: [
    { id: 'd1', name: 'Soda', price: 2.49 },
    { id: 'd2', name: 'Iced Tea', price: 2.49 },
    { id: 'd3', name: 'Lemonade', price: 3.49 },
    { id: 'd4', name: 'Water', price: 0.00 },
    { id: 'd5', name: 'Coffee', price: 2.99 },
  ],
  Extras: [
    { id: 'e1', name: 'Extra Cheese', price: 1.50 },
    { id: 'e2', name: 'Avocado', price: 2.00 },
    { id: 'e3', name: 'Bacon', price: 1.99 },
  ],
};

const TAX_RATE = 0.085;

/* ── Order Screen ────────────────────────────────────── */

export default function OrderScreen({ staff, order, onSave, onPay, onLogout }) {
  const [items, setItems] = useState(order.items || []);
  const [guestCount, setGuestCount] = useState(order.guest_count);
  const [category, setCategory] = useState('Mains');
  const [selectedLines, setSelectedLines] = useState(new Set());
  const [menu] = useState(DEMO_MENU);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.qty, 0),
    [items]
  );
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  function addItem(menuItem) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === menuItem.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { ...menuItem, qty: 1 }];
    });
  }

  function changeQty(lineId, delta) {
    setItems(prev => {
      return prev.map(i => {
        if (i.id !== lineId) return i;
        const newQty = i.qty + delta;
        return newQty > 0 ? { ...i, qty: newQty } : null;
      }).filter(Boolean);
    });
    if (delta < 0) {
      setSelectedLines(prev => {
        const next = new Set(prev);
        // Remove if item was deleted
        const still = items.find(i => i.id === lineId);
        if (still && still.qty + delta <= 0) next.delete(lineId);
        return next;
      });
    }
  }

  function toggleLine(id) {
    setSelectedLines(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function voidLines(ids) {
    setItems(prev => prev.filter(i => !ids.has(i.id)));
    setSelectedLines(new Set());
  }

  function handleSave() {
    onSave({
      ...order,
      items,
      guest_count: guestCount,
      total: `$${total.toFixed(2)}`,
      status: items.length > 0 ? 'printed' : 'open',
    });
  }

  function handlePay() {
    if (items.length === 0) return;
    onPay({
      ...order,
      items,
      guest_count: guestCount,
      total: `$${total.toFixed(2)}`,
    }, { items, subtotal, tax, total });
  }

  const selCount = selectedLines.size;
  const categories = Object.keys(menu);

  // Start time tracking
  const elapsed = order.elapsed || '0:00';

  const raisedBtn = {
    border: '2px solid',
    borderColor: '#fff #808080 #808080 #fff',
    background: '#c0c0c0',
    padding: '4px 8px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 10,
    width: '100%',
    textAlign: 'center',
    marginBottom: 3,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TBar staff={staff} onLogout={onLogout} />

      {/* Subheader */}
      <div style={{
        background: '#dfdfdf',
        padding: '4px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid #808080',
        fontSize: 11,
      }}>
        <span style={{ fontWeight: 'bold' }}>{order.label || order.id}</span>
        <span>|</span>
        <button
          onClick={() => setGuestCount(g => Math.max(1, g - 1))}
          style={{ width: 20, height: 18, border: '1px solid #808080', background: '#c0c0c0', cursor: 'pointer', fontWeight: 'bold' }}
        >−</button>
        <span style={{ fontWeight: 'bold' }}>{guestCount}G</span>
        <button
          onClick={() => setGuestCount(g => Math.min(20, g + 1))}
          style={{ width: 20, height: 18, border: '1px solid #808080', background: '#c0c0c0', cursor: 'pointer', fontWeight: 'bold' }}
        >+</button>
        <span>|</span>
        <span>{staff.name}</span>
        <span style={{ marginLeft: 'auto', color: '#808080' }}>{elapsed}</span>
      </div>

      {/* Main 3-column layout */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left — Check view */}
        <div style={{
          width: 200,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #808080',
          flexShrink: 0,
        }}>
          {selCount > 0 && (
            <div style={{
              background: '#000080',
              color: '#fff',
              padding: '3px 6px',
              fontSize: 10,
              fontWeight: 'bold',
            }}>
              {selCount} selected
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
            {items.map(item => (
              <div
                key={item.id}
                onClick={() => toggleLine(item.id)}
                style={{
                  padding: '3px 6px',
                  cursor: 'pointer',
                  background: selectedLines.has(item.id) ? '#000080' : 'transparent',
                  color: selectedLines.has(item.id) ? '#fff' : '#000',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  borderBottom: '1px solid #dfdfdf',
                }}
              >
                <span>{item.qty} × {item.name}</span>
                <span>${(item.price * item.qty).toFixed(2)}</span>
              </div>
            ))}
            {items.length === 0 && (
              <div style={{ color: '#808080', textAlign: 'center', padding: 16, fontSize: 10 }}>
                No items yet
              </div>
            )}
          </div>
          {/* Totals */}
          <div style={{
            borderTop: '2px solid #808080',
            padding: '6px',
            fontSize: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Tax 8.5%</span><span>${tax.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12, marginTop: 4 }}>
              <span>TOTAL</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Center — Menu items */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Category tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '2px solid #808080',
          }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: category === cat ? '#000080' : '#c0c0c0',
                  color: category === cat ? '#fff' : '#000',
                  fontWeight: 'bold',
                  border: '1px solid #808080',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          {/* Item grid */}
          <div style={{
            flex: 1,
            padding: 8,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
            alignContent: 'start',
          }}>
            {(menu[category] || []).map(item => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                style={{
                  height: 60,
                  border: '2px solid',
                  borderColor: '#fff #808080 #808080 #fff',
                  background: '#c0c0c0',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: 11,
                }}
              >
                <span>{item.name}</span>
                <span style={{ fontSize: 10, color: '#808080' }}>
                  ${item.price.toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Right — Actions */}
        <div style={{
          width: 130,
          padding: 6,
          borderLeft: '1px solid #808080',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflowY: 'auto',
        }}>
          {/* Context-dependent actions */}
          {selCount === 0 && (
            <>
              <button style={raisedBtn}>Discount</button>
              <button style={raisedBtn}>Comp</button>
              <button style={raisedBtn}>Fire All</button>
              <button style={raisedBtn}>Print Check</button>
            </>
          )}
          {selCount === 1 && (
            <>
              <button style={raisedBtn} onClick={() => {
                const id = [...selectedLines][0];
                changeQty(id, 1);
              }}>+ Qty</button>
              <button style={raisedBtn} onClick={() => {
                const id = [...selectedLines][0];
                changeQty(id, -1);
              }}>− Qty</button>
              <button style={raisedBtn}>Modify</button>
              <button style={raisedBtn} onClick={() => voidLines(selectedLines)}>Void Line</button>
              <div style={{ borderTop: '1px solid #808080', margin: '4px 0' }} />
              <button style={raisedBtn}>Discount</button>
              <button style={raisedBtn}>Comp</button>
              <button style={raisedBtn}>Fire All</button>
              <button style={raisedBtn}>Print Check</button>
            </>
          )}
          {selCount >= 2 && (
            <>
              <button style={raisedBtn}>Modify All</button>
              <button style={raisedBtn} onClick={() => voidLines(selectedLines)}>Void All</button>
              <button style={raisedBtn} onClick={() => setSelectedLines(new Set())}>Deselect</button>
              <div style={{ borderTop: '1px solid #808080', margin: '4px 0' }} />
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Save & Pay */}
          <button
            onClick={handleSave}
            style={{
              ...raisedBtn,
              background: '#c0c0c0',
              fontSize: 11,
              padding: '8px 0',
            }}
          >
            💾 Save Table
          </button>
          <button
            onClick={handlePay}
            disabled={items.length === 0}
            style={{
              ...raisedBtn,
              background: items.length === 0 ? '#808080' : '#000080',
              color: '#fff',
              fontSize: 11,
              padding: '8px 0',
              cursor: items.length === 0 ? 'default' : 'pointer',
            }}
          >
            Pay ▶
          </button>
        </div>
      </div>

      <TBarFooter />
    </div>
  );
}
