import { useState, useMemo } from 'react';
import TBar, { TBarFooter } from './TBar';

export default function PaymentScreen({ staff, order, payment, onCharge, onLogout }) {
  const { items, subtotal, tax, total } = payment;
  const [tab, setTab] = useState('cash');
  const [tender, setTender] = useState('');
  const [tip, setTip] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitCard, setSplitCard] = useState('');
  const [cardState, setCardState] = useState('waiting'); // waiting | processing | done

  const tipAmount = parseFloat(tip) || 0;
  const grandTotal = total + tipAmount;

  const tenderNum = parseFloat(tender) || 0;
  const change = Math.max(0, tenderNum - grandTotal);

  const splitRemaining = useMemo(() => {
    const cashPart = parseFloat(splitCash) || 0;
    const cardPart = parseFloat(splitCard) || 0;
    return Math.max(0, grandTotal - cashPart - cardPart);
  }, [splitCash, splitCard, grandTotal]);

  function setTipPercent(pct) {
    setTip((subtotal * pct).toFixed(2));
  }

  function handleCharge() {
    onCharge(order.id);
  }

  const tabBtnStyle = (active) => ({
    flex: 1,
    padding: '6px 0',
    background: active ? '#000080' : '#c0c0c0',
    color: active ? '#fff' : '#000',
    fontWeight: 'bold',
    border: '1px solid #808080',
    cursor: 'pointer',
    fontSize: 11,
  });

  const raisedBtn = {
    border: '2px solid',
    borderColor: '#fff #808080 #808080 #fff',
    background: '#c0c0c0',
    padding: '6px 10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 11,
  };

  const quickDenoms = [5, 10, 20, 50, 100];

  const methodLabel = tab === 'cash' ? 'Cash' : tab === 'card' ? 'Card' : 'Split';
  const canCharge = tab === 'cash'
    ? tenderNum >= grandTotal
    : tab === 'card'
    ? true
    : splitRemaining <= 0.01;

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
        <span>{staff.name}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 'bold', fontSize: 13 }}>
          Total: ${grandTotal.toFixed(2)}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left — Receipt summary */}
        <div style={{
          width: 190,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #808080',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
            {items.map(item => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  padding: '2px 0',
                  borderBottom: '1px solid #dfdfdf',
                }}
              >
                <span>{item.qty} × {item.name}</span>
                <span>${(item.price * item.qty).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{
            borderTop: '2px solid #808080',
            padding: 6,
            fontSize: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Tax 8.5%</span><span>${tax.toFixed(2)}</span>
            </div>
            {tipAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Tip</span><span>${tipAmount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12, marginTop: 4 }}>
              <span>TOTAL</span><span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Right — Payment method */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 8 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', marginBottom: 8 }}>
            <button style={tabBtnStyle(tab === 'cash')} onClick={() => setTab('cash')}>Cash</button>
            <button style={tabBtnStyle(tab === 'card')} onClick={() => setTab('card')}>Card</button>
            <button style={tabBtnStyle(tab === 'split')} onClick={() => setTab('split')}>Split</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Cash tab */}
            {tab === 'cash' && (
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
                  Tender Amount
                </label>
                <input
                  type="number"
                  value={tender}
                  onChange={e => setTender(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '2px solid',
                    borderColor: '#808080 #fff #fff #808080',
                    fontSize: 14,
                    marginBottom: 8,
                  }}
                  step="0.01"
                />
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {quickDenoms.map(d => (
                    <button
                      key={d}
                      onClick={() => setTender(String(d))}
                      style={raisedBtn}
                    >
                      ${d}
                    </button>
                  ))}
                  <button
                    onClick={() => setTender(grandTotal.toFixed(2))}
                    style={raisedBtn}
                  >
                    Exact
                  </button>
                </div>
                {tenderNum > 0 && (
                  <div style={{
                    background: tenderNum >= grandTotal ? '#c6ffbb' : '#ff6b6b',
                    padding: '6px 10px',
                    fontWeight: 'bold',
                    fontSize: 13,
                    border: '2px solid',
                    borderColor: '#808080 #fff #fff #808080',
                  }}>
                    Change: ${change.toFixed(2)}
                  </div>
                )}
              </div>
            )}

            {/* Card tab */}
            {tab === 'card' && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}>
                <div style={{
                  border: '2px solid',
                  borderColor: '#808080 #fff #fff #808080',
                  padding: 20,
                  textAlign: 'center',
                  background: '#fff',
                  width: '100%',
                  maxWidth: 240,
                }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>💳</div>
                  <div style={{ fontWeight: 'bold', fontSize: 12 }}>
                    {cardState === 'waiting' && 'Tap, Insert, or Swipe'}
                    {cardState === 'processing' && 'Processing...'}
                    {cardState === 'done' && 'Card Approved'}
                  </div>
                  <div style={{ fontSize: 10, color: '#808080', marginTop: 4 }}>
                    Waiting for card...
                  </div>
                </div>
              </div>
            )}

            {/* Split tab */}
            {tab === 'split' && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
                    Card Amount
                  </label>
                  <input
                    type="number"
                    value={splitCard}
                    onChange={e => setSplitCard(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      border: '2px solid',
                      borderColor: '#808080 #fff #fff #808080',
                      fontSize: 12,
                    }}
                    step="0.01"
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
                    Cash Amount
                  </label>
                  <input
                    type="number"
                    value={splitCash}
                    onChange={e => setSplitCash(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      border: '2px solid',
                      borderColor: '#808080 #fff #fff #808080',
                      fontSize: 12,
                    }}
                    step="0.01"
                  />
                </div>
                <div style={{
                  background: splitRemaining <= 0.01 ? '#c6ffbb' : '#fbde42',
                  padding: '6px 10px',
                  fontWeight: 'bold',
                  fontSize: 12,
                  border: '2px solid',
                  borderColor: '#808080 #fff #fff #808080',
                }}>
                  Remaining: ${splitRemaining.toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* Tip line */}
          <div style={{
            borderTop: '1px solid #808080',
            paddingTop: 8,
            marginBottom: 8,
          }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
              Tip
            </label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="number"
                value={tip}
                onChange={e => setTip(e.target.value)}
                placeholder="0.00"
                style={{
                  width: 80,
                  padding: '4px 6px',
                  border: '2px solid',
                  borderColor: '#808080 #fff #fff #808080',
                  fontSize: 12,
                }}
                step="0.01"
              />
              <button style={raisedBtn} onClick={() => setTipPercent(0.15)}>15%</button>
              <button style={raisedBtn} onClick={() => setTipPercent(0.18)}>18%</button>
              <button style={raisedBtn} onClick={() => setTipPercent(0.20)}>20%</button>
            </div>
          </div>

          {/* Charge button */}
          <button
            onClick={handleCharge}
            disabled={!canCharge}
            style={{
              width: '100%',
              padding: '10px 0',
              background: canCharge ? '#000080' : '#808080',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 14,
              border: '2px solid',
              borderColor: '#fff #808080 #808080 #fff',
              cursor: canCharge ? 'pointer' : 'default',
            }}
          >
            ✔ Charge {methodLabel} — ${grandTotal.toFixed(2)}
          </button>
        </div>
      </div>

      <TBarFooter />
    </div>
  );
}
