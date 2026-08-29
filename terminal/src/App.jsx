import { useState, useCallback } from 'react';
import LoginScreen from './components/LoginScreen';
import SnapshotScreen from './components/SnapshotScreen';
import OrderScreen from './components/OrderScreen';
import PaymentScreen from './components/PaymentScreen';

/*
  Scene Manager — all screens share TBar, footer, and root state.
  Navigation: login → snapshot → order → payment → snapshot
*/

export default function App() {
  // Root state
  const [screen, setScreen] = useState('login');
  const [staff, setStaff] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const [orders, setOrders] = useState([]);

  // ── Navigation handlers (scene transitions) ──────────

  const handleLogin = useCallback((staffMember) => {
    setStaff(staffMember);
    setScreen('snapshot');
    // TODO: fetch active orders from API
  }, []);

  const handleLogout = useCallback(() => {
    setScreen('login');
    setStaff(null);
    setCurrentOrder(null);
    setPayment(null);
    setOrders([]);
  }, []);

  const handleOpenOrder = useCallback((order) => {
    setCurrentOrder(order);
    setScreen('order');
  }, []);

  const handleNewOrder = useCallback((newOrder) => {
    setOrders(prev => [...prev, newOrder]);
    setCurrentOrder(newOrder);
    setScreen('order');
  }, []);

  const handleSaveTable = useCallback((updatedOrder) => {
    setOrders(prev => {
      const idx = prev.findIndex(o => o.id === updatedOrder.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updatedOrder;
        return next;
      }
      return [...prev, updatedOrder];
    });
    setCurrentOrder(null);
    setScreen('snapshot');
  }, []);

  const handleGoToPayment = useCallback((order, paymentData) => {
    setCurrentOrder(order);
    setPayment(paymentData);
    setScreen('payment');
  }, []);

  const handleCharge = useCallback((orderId) => {
    // Remove closed order from the list
    setOrders(prev => prev.filter(o => o.id !== orderId));
    setCurrentOrder(null);
    setPayment(null);
    setScreen('snapshot');
  }, []);

  // ── Scene renderer ────────────────────────────────────

  switch (screen) {
    case 'login':
      return <LoginScreen onLogin={handleLogin} />;

    case 'snapshot':
      return (
        <SnapshotScreen
          staff={staff}
          orders={orders}
          setOrders={setOrders}
          onOpenOrder={handleOpenOrder}
          onNewOrder={handleNewOrder}
          onPayment={handleGoToPayment}
          onLogout={handleLogout}
        />
      );

    case 'order':
      return (
        <OrderScreen
          staff={staff}
          order={currentOrder}
          onSave={handleSaveTable}
          onPay={handleGoToPayment}
          onLogout={handleLogout}
        />
      );

    case 'payment':
      return (
        <PaymentScreen
          staff={staff}
          order={currentOrder}
          payment={payment}
          onCharge={handleCharge}
          onLogout={handleLogout}
        />
      );

    default:
      return <LoginScreen onLogin={handleLogin} />;
  }
}
