import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

const FirebaseDetails: React.FC = () => {
  const [firebaseData, setFirebaseData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchFirebaseData = async () => {
      try {
        const response = await fetch('https://api.leaf.app.br/dashboard/firebase')
        const data = await response.json()
        setFirebaseData(data)
      } catch (error) {
        console.error('Erro ao buscar dados do Firebase:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchFirebaseData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Detalhes do Firebase</h1>
      
      {firebaseData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-4">Status</h3>
            <p className="text-2xl font-bold text-green-600">
              {firebaseData.status}
            </p>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-4">Conexões</h3>
            <p className="text-2xl font-bold text-blue-600">
              {firebaseData.connections}
            </p>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-4">Documentos</h3>
            <p className="text-2xl font-bold text-purple-600">
              {firebaseData.documents}
            </p>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-4">Latência</h3>
            <p className="text-2xl font-bold text-orange-600">
              {firebaseData.latency}ms
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center text-gray-500">
          <p>Nenhum dado disponível</p>
        </div>
      )}
    </div>
  )
}

export default FirebaseDetails 