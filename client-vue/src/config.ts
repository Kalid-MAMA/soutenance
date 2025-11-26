const isProd = import.meta.env.PROD;

export const API_URL = isProd 
  ? 'https://soutenance-qn88.onrender.com'
  : '';

export const WS_URL = isProd
  ? 'wss://soutenance-qn88.onrender.com/ws'
  : 'ws://localhost:5000/ws';