import React, { createContext, useContext, useEffect, useState } from 'react'
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { authService } from '../services/auth-service'

const AuthContext = createContext(undefined)

// Admin permissions
const ADMIN_PERMISSIONS = {
  'admin': ['dashboard:read', 'users:read', 'rides:read', 'reports:read', 'notifications:send'],
  'super-admin': ['dashboard:read', 'users:read', 'users:write', 'rides:read', 'rides:write', 'reports:read', 'reports:write', 'system:config', 'notifications:send'],
  'viewer': ['dashboard:read']
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authMethod, setAuthMethod] = useState(null)

  useEffect(() => {
    // Verificar autenticação JWT primeiro (prioridade)
    const checkJWTAuth = async () => {
      if (authService.isAuthenticated()) {
        try {
          const jwtUser = await authService.verifyToken()
          if (jwtUser) {
            // Converter JWT user para AdminUser
            const adminUser = {
              uid: jwtUser.id,
              email: jwtUser.email,
              displayName: jwtUser.name,
              emailVerified: true,
              role: jwtUser.role,
              permissions: jwtUser.permissions,
              lastLogin: new Date()
            }
            setUser(adminUser)
            setAuthMethod('jwt')
            setLoading(false)
            return
          }
        } catch (error) {
          console.warn('⚠️ Erro ao verificar token JWT, tentando Firebase Auth:', error)
        }
      }
      
      // Fallback para Firebase Auth
      setAuthMethod('firebase')
    }

    checkJWTAuth()

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Se já autenticado via JWT, ignorar Firebase Auth
      if (authMethod === 'jwt') {
        return
      }
      if (firebaseUser) {
        try {
          // Get user role and permissions from Firestore
          const userDoc = await getDoc(doc(db, 'adminUsers', firebaseUser.uid))
          const userData = userDoc.data()
          
          // Se o documento não existe, criar com permissões básicas
          if (!userDoc.exists() || !userData) {
            console.warn('⚠️ Documento adminUsers não encontrado, criando com permissões básicas...')
            
            // Tentar criar o documento
            try {
              await setDoc(doc(db, 'adminUsers', firebaseUser.uid), {
                email: firebaseUser.email,
                displayName: firebaseUser.displayName || 'Administrador',
                role: 'super-admin',
                permissions: ADMIN_PERMISSIONS['super-admin'],
                createdAt: new Date(),
                lastLogin: new Date(),
                active: true
              })
              
              const adminUser = {
                ...firebaseUser,
                role: 'super-admin',
                permissions: ADMIN_PERMISSIONS['super-admin'],
                lastLogin: new Date()
              }
              setUser(adminUser)
            } catch (createError) {
              console.error('❌ Erro ao criar documento adminUsers:', createError)
              // Se não conseguir criar, usar permissões básicas baseadas no token
              const tokenResult = await firebaseUser.getIdTokenResult()
              const claims = tokenResult.claims
              
              const roleValue = claims.role
              const validRole = (roleValue === 'admin' || roleValue === 'super-admin' || roleValue === 'viewer') 
                ? roleValue
                : 'viewer'
              
              const adminUser = {
                ...firebaseUser,
                role: validRole,
                permissions: (claims.permissions || []) || ADMIN_PERMISSIONS['viewer'],
                lastLogin: undefined
              }
              setUser(adminUser)
            }
          } else {
            console.log('✅ Documento adminUsers encontrado:', {
              role: userData?.role,
              permissions: userData?.permissions?.length,
              active: userData?.active
            })
            
            const userRole = userData?.role
            const validUserRole = (userRole === 'admin' || userRole === 'super-admin' || userRole === 'viewer')
              ? userRole
              : 'viewer'
            
            const adminUser = {
              ...firebaseUser,
              role: validUserRole,
              permissions: userData?.permissions || ADMIN_PERMISSIONS[validUserRole],
              lastLogin: userData?.lastLogin?.toDate ? userData.lastLogin.toDate() : undefined
            }
            
            console.log('✅ Usuário admin configurado:', {
              email: adminUser.email,
              role: adminUser.role,
              permissions: adminUser.permissions?.length
            })
            
            setUser(adminUser)
            
            // Update last login (tentar, mas não falhar se der erro)
            try {
              await setDoc(doc(db, 'adminUsers', firebaseUser.uid), {
                lastLogin: new Date(),
                email: firebaseUser.email,
                displayName: firebaseUser.displayName
              }, { merge: true })
              console.log('✅ lastLogin atualizado')
            } catch (updateError) {
              console.warn('⚠️ Não foi possível atualizar lastLogin:', updateError)
            }
          }
        } catch (error) {
          console.error('❌ Erro ao carregar dados do admin:', error)
          console.error('   Código:', error.code)
          console.error('   Mensagem:', error.message)
          
          // Se for erro de permissões, tentar criar o documento
          if (error.code === 'permission-denied' || error.code === 'PERMISSION_DENIED') {
            console.warn('⚠️ Erro de permissões detectado. Tentando criar documento adminUsers...')
            
            try {
              // Tentar criar documento com permissões de super-admin
              await setDoc(doc(db, 'adminUsers', firebaseUser.uid), {
                email: firebaseUser.email,
                displayName: firebaseUser.displayName || 'Administrador',
                role: 'super-admin',
                permissions: ADMIN_PERMISSIONS['super-admin'],
                createdAt: new Date(),
                lastLogin: new Date(),
                active: true
              })
              
              console.log('✅ Documento adminUsers criado com sucesso')
              
              const adminUser = {
                ...firebaseUser,
                role: 'super-admin',
                permissions: ADMIN_PERMISSIONS['super-admin'],
                lastLogin: new Date()
              }
              setUser(adminUser)
              return // Sair aqui se conseguiu criar
            } catch (createError) {
              console.error('❌ Não foi possível criar documento adminUsers:', createError)
              console.error('   Código:', createError.code)
              console.error('   Mensagem:', createError.message)
            }
          }
          
          // Fallback: usar claims do token se disponível
          try {
            const tokenResult = await firebaseUser.getIdTokenResult()
            const claims = tokenResult.claims
            
            console.log('📋 Claims do token:', claims)
            
            const fallbackRoleValue = claims.role
            const fallbackValidRole = (fallbackRoleValue === 'admin' || fallbackRoleValue === 'super-admin' || fallbackRoleValue === 'viewer')
              ? fallbackRoleValue
              : 'viewer'
            
            const adminUser = {
              ...firebaseUser,
              role: fallbackValidRole,
              permissions: (claims.permissions || []) || ADMIN_PERMISSIONS['viewer'],
              lastLogin: undefined
            }
            setUser(adminUser)
          } catch (tokenError) {
            console.error('❌ Erro ao obter claims do token:', tokenError)
            console.error('   Código:', tokenError.code)
            console.error('   Mensagem:', tokenError.message)
            
            // Último recurso: permissões mínimas
            const adminUser = {
              ...firebaseUser,
              role: 'viewer',
              permissions: ADMIN_PERMISSIONS['viewer'],
              lastLogin: undefined
            }
            setUser(adminUser)
          }
        }
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    return unsubscribe
  }, [authMethod])

  const signIn = async (email, password) => {
    try {
      setLoading(true)
      
      // Tentar login JWT primeiro
      try {
        const { user: jwtUser } = await authService.login(email, password)
        // Converter JWT user para AdminUser
        const adminUser = {
          uid: jwtUser.id,
          email: jwtUser.email,
          displayName: jwtUser.name,
          emailVerified: true,
          role: jwtUser.role,
          permissions: jwtUser.permissions,
          lastLogin: new Date()
        }
        setUser(adminUser)
        setAuthMethod('jwt')
        return
      } catch (jwtError) {
        // Se JWT falhar, tentar Firebase Auth (fallback)
        console.warn('⚠️ Login JWT falhou, tentando Firebase Auth:', jwtError.message)
        await signInWithEmailAndPassword(auth, email, password)
        setAuthMethod('firebase')
      }
    } catch (error) {
      console.error('Sign in error:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const signUp = async (email, password, name) => {
    try {
      setLoading(true)
      const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password)
      
      // Update profile
      await updateProfile(newUser, { displayName: name })
      
      // Create admin user document
      await setDoc(doc(db, 'adminUsers', newUser.uid), {
        email: email,
        displayName: name,
        role: 'viewer', // Default role
        permissions: ADMIN_PERMISSIONS['viewer'],
        createdAt: new Date(),
        lastLogin: new Date()
      })
    } catch (error) {
      console.error('Sign up error:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      setLoading(true)
      
      // Logout JWT se estiver usando
      if (authMethod === 'jwt' || authService.isAuthenticated()) {
        await authService.logout()
        setAuthMethod(null)
      }
      
      // Logout Firebase Auth (se estiver usando)
      if (authMethod === 'firebase' || auth.currentUser) {
        await signOut(auth)
      }
      
      setUser(null)
    } catch (error) {
      console.error('Logout error:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'super-admin'
  const isSuperAdmin = user?.role === 'super-admin'
  
  const hasPermission = (permission) => {
    return user?.permissions?.includes(permission) || false
  }

  const value = {
    user,
    loading,
    signIn,
    signUp,
    logout,
    isAdmin,
    isSuperAdmin,
    hasPermission
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}


