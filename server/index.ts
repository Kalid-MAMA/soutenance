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
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
  }
});

app.use(sessionParser);

// Configuration de WebSocket avec noServer: true
const wss = new WebSocketServer({ noServer: true });

// Map pour stocker les connexions WebSocket par userId
const clients = new Map<number, WebSocket>();

// Gestion de l'upgrade WebSocket
server.on('upgrade', (request, socket, head) => {
  console.log('🔵 WebSocket upgrade request received');
  console.log('URL:', request.url);
  console.log('Headers:', request.headers);
  
  sessionParser(request as any, {} as any, () => {
    const session = (request as any).session;
    console.log('Session:', session);
    
    if (!session?.userId) {
      console.log('❌ No userId in session, rejecting connection');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log('✅ Session valid, upgrading connection for user:', session.userId);
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});

wss.on('connection', (ws, req) => {
  // Utiliser le sessionParser pour obtenir la session
  const session = (req as any).session;
  console.log('🟢 WebSocket connected for user:', session.userId);
  
  // Stocker la connexion WebSocket avec l'ID de l'utilisateur
  clients.set(session.userId, ws);

  ws.on('close', () => {
    console.log('🔴 WebSocket disconnected for user:', session.userId);
    clients.delete(session.userId);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error for user:', session.userId, error);
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
    log(`serving on port ${port}`);
    log(`WebSocket available at ws${host === '0.0.0.0' ? 's' : ''}://${host}:${port}/ws`);
  });
})();

// Fonction pour envoyer des notifications aux administrateurs
export const notifyAdmins = async (type: string, data: any) => {
  try {
    // Récupérer tous les administrateurs depuis la base de données
    const admins = await storage.getAdminUsers();
    
    // Envoyer la notification à tous les administrateurs connectés
    admins.forEach(admin => {
      const ws = clients.get(admin.id);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type,
          userRole: 'admin',
          ...data
        }));
      }
    });
  } catch (error) {
    console.error('Error sending WebSocket notification:', error);
  }
}