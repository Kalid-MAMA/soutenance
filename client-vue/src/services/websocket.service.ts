import { useToast } from '@/composables/useToast'
import { useComplaintStore } from '@/stores/complaints'

class WebSocketService {
  private socket: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectTimeout = 1000 // 1 seconde
  private isConnecting = false
  private reconnectTimer: number | null = null

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.isConnecting) {
      console.log('WebSocket already connected or connecting')
      return
    }

    this.isConnecting = true
    
    // 🔥 CORRECTION IMPORTANTE : URL du backend WebSocket
    const wsUrl = this.getWebSocketUrl()
    console.log('🔵 Connecting to WebSocket:', wsUrl)

    try {
      this.socket = new WebSocket(wsUrl)

      this.socket.onopen = () => {
        console.log('✅ WebSocket connected successfully')
        this.reconnectAttempts = 0
        this.isConnecting = false
      }

      this.socket.onmessage = (event) => {
        console.log('📩 WebSocket message received:', event.data)
        try {
          const data = JSON.parse(event.data)
          this.handleMessage(data)
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error)
        }
      }

      this.socket.onclose = (event) => {
        console.log('🔴 WebSocket disconnected:', event.code, event.reason)
        this.socket = null
        this.isConnecting = false
        this.tryReconnect()
      }

      this.socket.onerror = (error) => {
        console.error('❌ WebSocket error:', error)
        this.isConnecting = false
      }
    } catch (error) {
      console.error('❌ Error creating WebSocket:', error)
      this.isConnecting = false
      this.tryReconnect()
    }
  }

  /**
   * 🔥 NOUVELLE MÉTHODE : Obtenir l'URL WebSocket correcte
   */
  private getWebSocketUrl(): string {
    // En développement local
    if (import.meta.env.DEV) {
      return 'ws://localhost:5000/ws'
    }

    // En production - URL de votre backend Render
    // Option 1: URL hardcodée (simple et fiable)
    return 'wss://soutenance-1-yb50.onrender.com/ws'

    // Option 2: Variable d'environnement (recommandé pour la flexibilité)
    // Créez un fichier .env.production avec : VITE_WS_URL=wss://soutenance-1-yb50.onrender.com/ws
    // return import.meta.env.VITE_WS_URL || 'wss://soutenance-1-yb50.onrender.com/ws'
  }

  private tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached')
      const toast = useToast()
      toast.error({
        title: 'Erreur de connexion',
        message: 'Impossible de se connecter au serveur. Veuillez rafraîchir la page.'
      })
      return
    }

    // Nettoyer le timer précédent
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectAttempts++
    const delay = this.reconnectTimeout * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`)
    
    this.reconnectTimer = window.setTimeout(() => {
      this.connect()
    }, delay)
  }

  private async handleMessage(data: any) {
    console.log('📨 Handling message:', data.type)
    
    const toast = useToast()
    const complaintStore = useComplaintStore()

    switch (data.type) {
      case 'connection_established':
        console.log('✅ Connection established:', data)
        break

      case 'NEW_COMPLAINT':
        if (data.complaint) {
          console.log('📋 New complaint received:', data.complaint)
          
          // Mettre à jour le store avec la nouvelle réclamation
          complaintStore.addComplaint(data.complaint)
          
          // Afficher une notification pour l'administrateur
          if (data.userRole === 'admin') {
            toast.info({
              title: 'Nouvelle réclamation',
              message: `Une nouvelle réclamation a été soumise par ${data.complaint.employee?.firstName} ${data.complaint.employee?.lastName}`
            })
          }
        }
        break

      case 'COMPLAINT_UPDATED':
        if (data.complaint && data.complaint.id) {
          console.log('📝 Complaint updated:', data.complaint)
          // La méthode updateComplaint attend (id, complaint)
          const { id, ...complaintData } = data.complaint
          complaintStore.updateComplaint(id, complaintData)
        }
        break

      case 'COMPLAINT_DELETED':
        if (data.complaintId) {
          console.log('🗑️ Complaint deleted:', data.complaintId)
          complaintStore.resolveComplaint(data.complaintId)
        }
        break

      default:
        console.log('❓ Unknown message type:', data.type, data)
    }
  }

  /**
   * Envoyer un message au serveur
   */
  send(data: any) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot send message: WebSocket is not connected')
      return false
    }

    try {
      const message = JSON.stringify(data)
      this.socket.send(message)
      console.log('📤 Message sent:', message)
      return true
    } catch (error) {
      console.error('❌ Error sending message:', error)
      return false
    }
  }

  /**
   * Fermer la connexion
   */
  disconnect() {
    console.log('🔌 Disconnecting WebSocket...')
    
    // Nettoyer le timer de reconnexion
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Empêcher les reconnexions automatiques
    this.reconnectAttempts = this.maxReconnectAttempts

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect')
      this.socket = null
    }
    
    this.isConnecting = false
  }

  /**
   * Obtenir l'état de la connexion
   */
  getState(): string {
    if (!this.socket) return 'DISCONNECTED'
    
    switch (this.socket.readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING'
      case WebSocket.OPEN: return 'CONNECTED'
      case WebSocket.CLOSING: return 'CLOSING'
      case WebSocket.CLOSED: return 'CLOSED'
      default: return 'UNKNOWN'
    }
  }

  /**
   * Vérifier si connecté
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }
}

export const wsService = new WebSocketService()