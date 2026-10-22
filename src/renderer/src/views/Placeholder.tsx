/** Marcador de posición de las pestañas de la siguiente fase (Tasks 11/12 reemplazan cada archivo de vista). */
export default function Placeholder({ title }: { title: string }) {
  return (
    <section className="placeholder" aria-label={title}>
      <h3>{title}</h3>
      <p>Disponible en la siguiente fase.</p>
    </section>
  )
}
