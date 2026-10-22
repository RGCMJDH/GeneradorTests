// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuoteLink } from '../../src/renderer/src/components/QuoteLink'
import { Correction } from '../../src/renderer/src/components/Correction'

const HINT = /Es el pasaje de tus apuntes en el que se apoya la pregunta/
const OWN = 'Esta cita es la guardada con la pregunta; la cita que propuso el modelo no se pudo verificar.'

describe('QuoteLink: honestidad del bloque', () => {
  it('verified:true → insignia y pista de procedencia', () => {
    render(<QuoteLink quote="La célula" verified chunkId={3} />)
    expect(screen.getByText('Cita verificada en tus apuntes')).toBeInTheDocument()
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver en apuntes' })).toBeInTheDocument()
  })

  it('verified:false → aviso, sin insignia y sin la pista de procedencia', () => {
    render(<QuoteLink quote="La célula" verified={false} chunkId={3} />)
    expect(screen.getByText('No se pudo verificar la cita')).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(screen.queryByText(/verificada en tus apuntes/)).not.toBeInTheDocument()
  })

  it('verified indefinido (historial) → texto neutro, sin insignia ni pista de procedencia', () => {
    render(<QuoteLink quote="La célula" />)
    expect(screen.getByText('Cita guardada con la pregunta; no se ha comprobado ahora.')).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(screen.queryByText(/verificad/i)).not.toBeInTheDocument()
    expect(screen.queryByText('No se pudo verificar la cita')).not.toBeInTheDocument()
  })

  it.each([true, false, undefined])('cita vacía (verified=%s) → no se pinta nada', (verified) => {
    const { container } = render(<QuoteLink quote="  " verified={verified} chunkId={3} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Correction: cita propia con marcador del modelo', () => {
  const props = { correct: true, quote: 'La célula', chunkId: 3 }
  it('marcador + verified:true → línea explicativa dentro del bloque de la cita', () => {
    render(<Correction {...props} feedback="Bien. (cita del modelo no verificada)" verified />)
    expect(screen.getByText(OWN)).toBeInTheDocument()
    expect(screen.getByLabelText('Fragmento de origen', { selector: 'aside' })).toContainElement(screen.getByText(OWN))
  })
  it('marcador + verified:false → sin la línea (no hay cita verificada que explicar)', () => {
    render(<Correction {...props} feedback="Bien. (cita del modelo no verificada)" verified={false} />)
    expect(screen.queryByText(OWN)).not.toBeInTheDocument()
  })
  it('sin marcador → sin la línea', () => {
    render(<Correction {...props} feedback="Bien." verified />)
    expect(screen.queryByText(OWN)).not.toBeInTheDocument()
  })
})
