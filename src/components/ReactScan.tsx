import * as React from 'react'

export function ReactScan() {
  React.useEffect(() => {
    if (!import.meta.env.DEV) return
    import('react-scan').then(({ scan }) => {
      scan({ enabled: true })
    })
  }, [])

  return null
}
