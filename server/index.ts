import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import cors from "cors";
import SQLiteStore from "connect-sqlite3";
import { join } from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const app = express();
const server = http.createServer(app);

// Configuration CORS
app.use(cors({
  origin: true, // Autoriser toutes les origines en développement
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Set-Cookie'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configuration du stockage des sessions
const SQLiteStoreSession = SQLiteStore(session);
const sessionParser = session({
  store: new SQLiteStoreSession({
    db: 'data/sessions.db',
    table: 'sessions'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, // 🔥 Sécurité contre XSS
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 🔥 Important pour CORS
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
  }
});

app.use(sessionParser);

// Configuration de WebSocket avec noServer: true
const wss = new WebSocketServer({ noServer: true });

// Map pour stocker les connexions WebSocket par userId
const clients = new Map<number, WebSocket>();

// 🔥 Gestion de l'upgrade WebSocket - VERSION PERMISSIVE POUR DEBUG
server.on('upgrade', (request, socket, head) => {
  console.log('🔵 WebSocket upgrade request received');
  console.log('URL:', request.url);
  console.log('Headers:', JSON.stringify(request.headers, null, 2));
  
  // Vérifier que c'est bien une requête WebSocket pour /ws
  if (request.url !== '/ws') {
    console.log('❌ Invalid WebSocket path:', request.url);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // Parser la session
  sessionParser(request as any, {} as any, () => {
    const session = (request as any).session;
    console.log('📋 Session data:', JSON.stringify(session, null, 2));
    
    // ⚠️ MODE DEBUG : Accepter même sans session pour tester
    if (!session?.userId) {
      console.log('⚠️ No userId in session - accepting connection anyway (DEBUG MODE)');
      console.log('🔧 EN PRODUCTION: Décommentez les lignes ci-dessous pour forcer l\'authentification');
      
      // 🔒 EN PRODUCTION, décommentez ces lignes pour forcer l'authentification :
      // socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      // socket.destroy();
      // return;
    } else {
      console.log('✅ User authenticated:', session.userId);
    }

    console.log('🟢 Upgrading WebSocket connection...');
    
    // Upgrade vers WebSocket
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});

// 🔥 Gestion des connexions WebSocket
wss.on('connection', (ws, req) => {
  const session = (req as any).session;
  const userId = session?.userId;
  
  console.log('🟢 WebSocket connected', userId ? `for user: ${userId}` : '(anonymous)');
  
  if (userId) {
    clients.set(userId, ws);
  }

  // Envoyer un message de confirmation
  ws.send(JSON.stringify({
    type: 'connection_established',
    userId: userId || null,
    authenticated: !!userId,
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (message) => {
    console.log('📩 Received message:', message.toString());
    try {
      const data = JSON.parse(message.toString());
      console.log('Parsed message:', data);
      
      // Vérifier l'authentification pour certaines actions
      if (!userId && data.requiresAuth) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required'
        }));
        return;
      }
      
      // Traiter les différents types de messages ici
      // ...
      
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔴 WebSocket disconnected', userId ? `for user: ${userId}` : '');
    if (userId) {
      clients.delete(userId);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error', userId ? `for user: ${userId}` : '', error);
  });

  ws.on('pong', () => {
    console.log('🏓 Pong received from', userId ? `user ${userId}` : 'client');
  });
});

// 🔥 Heartbeat pour maintenir les connexions actives (important pour Render)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000); // Toutes les 30 secondes

// 🔥 Nettoyer l'interval à l'arrêt du serveur
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing WebSocket server...');
  clearInterval(heartbeatInterval);
  wss.close(() => {
    console.log('✅ WebSocket server closed');
  });
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

  server.listen({
    port,
    host,
  }, () => {
    log(`🚀 Server running on port ${port}`);
    log(`📡 WebSocket available at ws${host === '0.0.0.0' ? 's' : ''}://${host}:${port}/ws`);
  });
})();

// 🔥 Fonction pour envoyer des notifications aux administrateurs
export const notifyAdmins = async (type: string, data: any) => {
  try {
    // Note: Vous devez importer ou définir 'storage' quelque part
    // const admins = await storage.getAdminUsers();
    
    // Pour l'instant, on va parcourir tous les clients connectés
    console.log('📢 Notifying admins:', type, data);
    
    // Envoyer la notification à tous les administrateurs connectés
    clients.forEach((ws, userId) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type,
          userRole: 'admin', // À vérifier avec la vraie base de données
          ...data
        }));
        console.log(`✉️ Notification sent to user ${userId}`);
      }
    });
  } catch (error) {
    console.error('❌ Error sending WebSocket notification:', error);
  }
};

// Exporter les clients pour utilisation dans d'autres modules
export { clients };