import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Avatar, AvatarFallback } from './ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet'
import {
  Home,
  BarChart3,
  MapPin,
  Users,
  List,
  Bell,
  Settings,
  LogOut,
  FileText,
  TrendingUp,
  Shield,
  MessageCircle,
  Menu,
  ChevronDown,
  Activity,
  Calculator
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ✅ Menu simplificado - sem duplicações
const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: Home },
  { label: 'Métricas', href: '/metrics', icon: BarChart3 },
  { label: 'Histórico', href: '/metrics-history', icon: TrendingUp },
  { label: 'Simulador', href: '/financial-simulator', icon: Calculator },
  { label: 'Observabilidade', href: '/observability', icon: Activity },
  { label: 'Usuários', href: '/users', icon: Users },
  { label: 'Lista de Espera', href: '/waitlist', icon: List },
  { label: 'Mapas', href: '/maps', icon: MapPin },
  { label: 'Suporte', href: '/support', icon: MessageCircle },
  { label: 'Notificações', href: '/notifications', icon: Bell },
  { label: 'Relatórios', href: '/reports', icon: FileText },
]

export default function Navigation() {
  const router = useRouter()
  const { user, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isActive = (href) => {
    if (href === '/dashboard') {
      return router.pathname === '/dashboard' || router.pathname === '/'
    }
    return router.pathname === href
  }

  return (
    <div className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6 lg:px-8">
        {/* Logo / Brand */}
        <Link href="/dashboard" className="flex items-center gap-2 md:gap-3 cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0">
          <img
            src="/favicon.svg"
            alt="Leaf"
            className="h-8 w-8 md:h-10 md:w-10"
            onError={(e) => {
              // Fallback se imagem não carregar
              e.target.style.display = 'none'
              e.target.nextSibling.style.display = 'flex'
            }}
          />
          <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary text-primary-foreground hidden">
            <span className="text-lg md:text-xl font-bold">L</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg md:text-2xl font-bold text-primary">Leaf</h1>
            <span className="hidden text-xs text-muted-foreground lg:block">
              Admin Dashboard
            </span>
          </div>
        </Link>

        {/* Navigation Links - Desktop */}
        <nav className="hidden lg:flex items-center gap-1 flex-wrap justify-center flex-1 max-w-5xl mx-4">
          {navItems.map((item) => {
            const active = isActive(item.href)
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={active ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "gap-2 px-3 text-sm whitespace-nowrap",
                    active && "bg-primary text-primary-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            )
          })}
        </nav>

        {/* Right Side - User Info & Actions */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4 md:h-5 md:w-5" />
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-4 w-4 md:h-5 md:w-5 flex items-center justify-center p-0 text-[10px] md:text-xs"
            >
              3
            </Badge>
          </Button>

          {/* Settings */}
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Settings className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
          </Link>

          {/* User Profile - Desktop */}
          <div className="hidden md:flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-9 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs">
                      {(user?.displayName || 'A').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start hidden lg:flex">
                    <span className="text-xs font-semibold leading-tight">
                      {user?.displayName || 'Admin'}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {user?.role || 'viewer'}
                    </span>
                  </div>
                  <ChevronDown className="h-3 w-3 hidden lg:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user?.displayName || 'Admin'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email || ''}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Configurações
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile Menu */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-1">
                {navItems.map((item) => {
                  const active = isActive(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Button
                        variant={active ? "default" : "ghost"}
                        className={cn(
                          "w-full justify-start gap-3",
                          active && "bg-primary text-primary-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Button>
                    </Link>
                  )
                })}
                <div className="pt-4 border-t">
                  <div className="px-2 py-2 mb-2">
                    <p className="text-sm font-medium">{user?.displayName || 'Admin'}</p>
                    <p className="text-xs text-muted-foreground">{user?.email || ''}</p>
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 text-destructive"
                    onClick={() => {
                      logout()
                      setMobileMenuOpen(false)
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sair
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  )
}


