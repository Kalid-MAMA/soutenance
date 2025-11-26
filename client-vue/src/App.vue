<script setup lang="ts">
import { onMounted, ref, onUnmounted, computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import ToastContainer from './components/ui/toast-container.vue'
import AppFooter from '@/components/AppFooter.vue'
import { setToastContainer } from './composables/useToast'
import { wsService } from '@/services/websocket.service'
import { useAuthStore } from '@/stores/auth' // 🔥 Importez votre store d'authentification

const toastContainer = ref()
const route = useRoute()
const authStore = useAuthStore() // 🔥 Récupérer le store d'auth

// Utiliser le chemin de la route comme clé pour forcer le rechargement des composants
const routeKey = computed(() => route.fullPath)

// Vérifier si la page actuelle est la page de connexion
const isLoginPage = computed(() => route.path === '/login')

onMounted(() => {
  if (toastContainer.value) {
    setToastContainer(toastContainer.value)
  }
  
  // 🔥 Connecter WebSocket uniquement si l'utilisateur est authentifié
  if (authStore.isAuthenticated) {
    console.log('✅ User already authenticated, connecting WebSocket...')
    wsService.connect()
  } else {
    console.log('⚠️ User not authenticated, WebSocket will connect after login')
  }
})

// 🔥 Watcher pour gérer la connexion/déconnexion WebSocket selon l'authentification
watch(() => authStore.isAuthenticated, (isAuthenticated, wasAuthenticated) => {
  console.log('🔄 Auth state changed:', { isAuthenticated, wasAuthenticated })
  
  if (isAuthenticated && !wasAuthenticated) {
    // L'utilisateur vient de se connecter
    console.log('✅ User just logged in, connecting WebSocket...')
    wsService.connect()
  } else if (!isAuthenticated && wasAuthenticated) {
    // L'utilisateur vient de se déconnecter
    console.log('🔴 User just logged out, disconnecting WebSocket...')
    wsService.disconnect()
  }
})

onUnmounted(() => {
  wsService.disconnect()
})
</script>

<template>
  <div class="min-h-screen w-full bg-gray-50 flex flex-col">
    <!-- Contenu principal -->
    <div class="flex-grow">
      <RouterView :key="routeKey" />
    </div>
    
    <!-- Footer sur toutes les pages -->
    <AppFooter class="z-50 relative" />
    
    <!-- Container pour les notifications toast -->
    <ToastContainer ref="toastContainer" />
  </div>
</template>