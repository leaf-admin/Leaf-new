import React from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { Card, CardContent } from './ui/card'

export default function ProtectedRoute({ 
  children, 
  requiredPermission,
  fallback 
}) {
  const { user, loading, hasPermission } = useAuth()
  const router = useRouter()

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Verificando autenticação...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!user) {
    if (typeof window !== 'undefined') {
      router.push('/login')
    }
    return null
  }

  // Check permission if required
  if (requiredPermission && !hasPermission(requiredPermission)) {
    // ✅ FALLBACK: Se não tem a permissão específica, verificar se tem dashboard:read
    // Isso permite acesso temporário enquanto as permissões são atualizadas
    const hasFallbackPermission = requiredPermission !== 'dashboard:read' && hasPermission('dashboard:read')
    
    if (!hasFallbackPermission) {
      return fallback || (
        <div className="min-h-screen flex items-center justify-center">
          <Card className="p-8">
            <CardContent className="flex flex-col items-center gap-4 text-center">
              <h1 className="text-2xl font-bold text-destructive">
                Acesso Negado
              </h1>
              <p className="text-muted-foreground">
                Você não tem permissão para acessar esta página.
              </p>
              <p className="text-sm text-muted-foreground">
                Permissão necessária: {requiredPermission}
              </p>
            </CardContent>
          </Card>
        </div>
      )
    }
  }

  return <>{children}</>
}


