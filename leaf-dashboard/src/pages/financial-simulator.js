import Head from 'next/head'
import { useState } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { leafAPI } from '../services/api'
import {
    Calculator,
    Car,
    Clock,
    TrendingUp,
    DollarSign,
    ShieldAlert,
    Percent,
    Banknote
} from 'lucide-react'

export default function FinancialSimulator() {
    const [drivers, setDrivers] = useState(250)
    const [hours, setHours] = useState(1)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [report, setReport] = useState(null)

    const runSimulation = async () => {
        try {
            setLoading(true)
            setError(null)
            const data = await leafAPI.runFinancialSimulation(drivers, hours)
            setReport(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao executar simulação')
        } finally {
            setLoading(false)
        }
    }

    return (
        <ProtectedRoute>
            <Head>
                <title>Simulador Financeiro - Leaf</title>
            </Head>
            <div className="min-h-screen bg-background">
                <Navigation />
                <div className="p-8 max-w-7xl mx-auto">

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                        <div>
                            <h1 className="text-3xl font-bold flex items-center gap-2">
                                <Calculator className="h-8 w-8 text-primary" />
                                Simulador Financeiro (Tokenomics)
                            </h1>
                            <p className="text-muted-foreground mt-1">
                                Projete o fluxo de caixas, custos operacionais e Fundo de Reserva variando a escala da frota.
                            </p>
                        </div>
                    </div>

                    <Card className="mb-8 border-primary/20 shadow-sm bg-primary/5">
                        <CardContent className="p-6">
                            <div className="flex flex-col md:flex-row gap-6 items-end">
                                <div className="w-full md:w-1/3">
                                    <label className="text-sm font-semibold mb-2 block">Motoristas Ativos (Frota)</label>
                                    <div className="flex items-center gap-2">
                                        <Car className="h-5 w-5 text-muted-foreground" />
                                        <input
                                            type="number"
                                            min="1"
                                            value={drivers}
                                            onChange={(e) => setDrivers(Number(e.target.value))}
                                            className="w-full p-2 border rounded-md"
                                        />
                                    </div>
                                </div>
                                <div className="w-full md:w-1/3">
                                    <label className="text-sm font-semibold mb-2 block">Horas de Operação Simulada</label>
                                    <div className="flex items-center gap-2">
                                        <Clock className="h-5 w-5 text-muted-foreground" />
                                        <input
                                            type="number"
                                            min="0.5"
                                            step="0.5"
                                            value={hours}
                                            onChange={(e) => setHours(Number(e.target.value))}
                                            className="w-full p-2 border rounded-md"
                                        />
                                    </div>
                                </div>
                                <div className="w-full md:w-1/3">
                                    <Button
                                        onClick={runSimulation}
                                        disabled={loading}
                                        className="w-full h-10 shadow-md"
                                    >
                                        {loading ? 'Processando Algoritmo...' : 'Rodar Simulação Estocástica'}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {error && (
                        <Alert variant="destructive" className="mb-6">
                            <AlertDescription>Erro: {error}</AlertDescription>
                        </Alert>
                    )}

                    {report && !loading && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                            {/* Visão Consolidada */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <Card>
                                    <CardContent className="p-6 flex flex-col items-center text-center">
                                        <TrendingUp className="h-8 w-8 text-blue-500 mb-2" />
                                        <h3 className="text-2xl font-bold">{report.completed}</h3>
                                        <p className="text-sm text-muted-foreground">Corridas Concluídas Sucesso</p>
                                        <Badge variant="outline" className="mt-2 bg-blue-50 text-blue-700">
                                            {((report.completed / report.totalRequests) * 100).toFixed(1)}% de sucesso
                                        </Badge>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="p-6 flex flex-col items-center text-center">
                                        <Percent className="h-8 w-8 text-orange-500 mb-2" />
                                        <h3 className="text-2xl font-bold">{report.canceledByPassenger}</h3>
                                        <p className="text-sm text-muted-foreground">Canceladas Passageiro</p>
                                        <Badge variant="outline" className="mt-2 bg-orange-50 text-orange-700">
                                            {((report.canceledByPassenger / report.totalRequests) * 100).toFixed(1)}% na busca
                                        </Badge>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="p-6 flex flex-col items-center text-center">
                                        <Car className="h-8 w-8 text-gray-500 mb-2" />
                                        <h3 className="text-2xl font-bold">{report.rejectedByDriver}</h3>
                                        <p className="text-sm text-muted-foreground">Rejeitadas/Ignoradas Motorista</p>
                                        <Badge variant="outline" className="mt-2 bg-gray-50 text-gray-700">
                                            {((report.rejectedByDriver / report.totalRequests) * 100).toFixed(1)}% dos toques
                                        </Badge>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="p-6 flex flex-col items-center text-center">
                                        <ShieldAlert className="h-8 w-8 text-red-500 mb-2" />
                                        <h3 className="text-2xl font-bold">{report.refundedAfterCompletion}</h3>
                                        <p className="text-sm text-muted-foreground">Chargebacks / Suporte</p>
                                        <Badge variant="outline" className="mt-2 bg-red-50 text-red-700">
                                            {((report.refundedAfterCompletion / report.totalRequests) * 100).toFixed(1)}% prejuízo assumido
                                        </Badge>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Fluxo Financeiro Ecosystema */}
                            <h2 className="text-xl font-bold mt-8 mb-4">Fluxo Global do Ecossistema</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Card className="border-l-4 border-l-blue-500">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-lg">GMV Total</CardTitle>
                                        <CardDescription>Volume Bruto Processado (Série T)</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-blue-600">
                                            R$ {report.grossVolume.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border-l-4 border-l-green-500">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-lg">Repasse Motoristas</CardTitle>
                                        <CardDescription>Líquido Depositado aos Parceiros</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-green-600">
                                            R$ {report.totalDriverPayout.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border-l-4 border-l-slate-400">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-lg">Deduções Parceiros</CardTitle>
                                        <CardDescription>Gateway (Woovi) e Pedágios</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-lg font-bold">
                                            Woovi: R$ {report.totalWooviFees.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </div>
                                        <div className="text-lg font-bold">
                                            Pedágios: R$ {report.totalTollsPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Economics Leaf */}
                            <h2 className="text-xl font-bold mt-8 mb-4">Economia da Plataforma (Leaf Op Fees)</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Break-down Costs */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Banknote className="h-5 w-5" />
                                            Análise de Faturamento
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="flex justify-between items-center border-b pb-2">
                                            <span className="font-medium">Receita Bruta Arrecadada (Taxa Op)</span>
                                            <span className="font-bold text-lg">
                                                R$ {report.leafGrossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-red-600 border-b pb-2">
                                            <span>[-] Fundo de Reserva (Taxa PIX Corridas Canceladas)</span>
                                            <span className="font-semibold">
                                                R$ {report.preAcceptanceCancellationCosts.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-red-600 border-b pb-2">
                                            <span>[-] Assunção Chargebacks (Risco Operacional Pós-Corrida)</span>
                                            <span className="font-semibold">
                                                R$ {Math.max(0, report.leafGrossRevenue - report.leafNetRevenue - report.preAcceptanceCancellationCosts).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2">
                                            <span className="font-bold text-xl uppercase">Resultado Líquido do Período</span>
                                            <span className="font-black text-2xl text-primary">
                                                R$ {report.leafNetRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Projection 30 Days */}
                                <Card className="bg-primary text-primary-foreground border-none">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-primary-foreground">
                                            <TrendingUp className="h-5 w-5" />
                                            Projeção Mensal Estimada
                                        </CardTitle>
                                        <CardDescription className="text-primary-foreground/80">
                                            Escalando o período simulado x 12h de pico diário x 30 dias
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="flex flex-col items-center justify-center p-6 bg-primary-foreground/10 rounded-xl">
                                            <span className="text-lg font-medium mb-2">Lucro Líquido Projetado ao Mês</span>
                                            <div className="text-4xl lg:text-5xl font-black">
                                                R$ {(report.leafNetRevenue * 12 * 30).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </div>
                                            <Badge className="mt-4 bg-primary-foreground text-primary hover:bg-primary-foreground/90 text-sm">
                                                Modelo de Faturamento R$ 0.79 a R$ 1.49 fixo
                                            </Badge>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                        </div>
                    )}

                </div>
            </div>
        </ProtectedRoute>
    )
}
