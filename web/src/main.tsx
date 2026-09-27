import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import App from './App'
import { loadRuntime, type Runtime } from './config'
import { errorText } from './math'
import './style.css'

function Bootstrap() {
  const [runtime, setRuntime] = useState<Runtime>()
  const [error, setError] = useState('')
  useEffect(() => { loadRuntime().then(setRuntime).catch(e => setError(errorText(e))) }, [])
  if (runtime) return <App runtime={runtime}/>
  return <main className="boot"><span className="eyebrow">Gas Tax · Sepolia lab</span><h1>{error ? 'Deployment unavailable.' : 'Opening the lab.'}</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading the deployment manifest and verifying contract interfaces…'}</p>{error && <button className="button dark" onClick={() => location.reload()}>Reload configuration</button>}</main>
}
createRoot(document.getElementById('root')!).render(<Bootstrap/> )
