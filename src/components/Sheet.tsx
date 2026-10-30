import { AnimatePresence, animate, motion, useDragControls, useMotionValue, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton } from './ui'

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 40, mass: 0.9 }

/**
 * Persistent bottom sheet for map screens (mobile). Snap points are the
 * fraction of the screen the sheet covers. Drag from the handle/header;
 * the body scrolls independently.
 */
export function BottomSheet({
  snaps = [0.36, 0.9],
  initial = 0,
  header,
  footer,
  children,
  snapTo,
}: {
  snaps?: number[]
  initial?: number
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  /** Change this to programmatically move the sheet to a snap index. */
  snapTo?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(0)
  const [index, setIndex] = useState(initial)
  const y = useMotionValue(10_000)
  const controls = useDragControls()
  const max = Math.max(...snaps)

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => setH(parent.clientHeight))
    ro.observe(parent)
    setH(parent.clientHeight)
    return () => ro.disconnect()
  }, [])

  const offsetFor = (i: number) => (max - snaps[i]) * h

  useEffect(() => {
    if (!h) return
    animate(y, offsetFor(index), SPRING)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, index, snaps.join(',')])

  useEffect(() => {
    if (snapTo !== undefined) setIndex(Math.min(snapTo, snaps.length - 1))
  }, [snapTo, snaps.length])

  function onDragEnd(_: unknown, info: PanInfo) {
    const projected = y.get() + info.velocity.y * 0.18
    let best = 0
    snaps.forEach((_, i) => {
      if (Math.abs(offsetFor(i) - projected) < Math.abs(offsetFor(best) - projected)) best = i
    })
    if (best === index) animate(y, offsetFor(best), SPRING)
    setIndex(best)
  }

  return (
    <>
    <motion.div
      ref={ref}
      className="sheet"
      style={{ height: h ? max * h : `${max * 100}%`, y }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: offsetFor(0) + 40 }}
      dragElastic={0.08}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      role="region"
      aria-label="Details"
    >
      <div className="sheet__handle-zone" onPointerDown={(e) => controls.start(e)}>
        <button
          type="button"
          className="sheet__handle"
          aria-label={index === snaps.length - 1 ? 'Collapse details' : 'Expand details'}
          onClick={() => setIndex((i) => (i === snaps.length - 1 ? 0 : snaps.length - 1))}
        />
      </div>
      {header && (
        <div onPointerDown={(e) => controls.start(e)} style={{ touchAction: 'none' }}>
          {header}
        </div>
      )}
      <div className="sheet__body" style={footer ? { paddingBottom: 96 + (snaps.length ? (max - snaps[index]) * h : 0) } : undefined}>
        {children}
      </div>
    </motion.div>
    {/* Footer is pinned to the screen, not the sheet, so the primary action is always reachable. */}
    {footer && <div className="sheet__footer sheet__footer--pinned">{footer}</div>}
    </>
  )
}

/** Modal bottom sheet (mobile) / centred dialog (≥640px). */
export function ModalSheet({
  open,
  onClose,
  title,
  children,
  footer,
  labelledBy,
  dismissible = true,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  labelledBy?: string
  dismissible?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissible && onClose()
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('input, [data-autofocus], button:not([aria-label="Close"])')?.focus(), 60)
    // Keep the sheet above the on-screen keyboard (iPhone Safari doesn't shrink the page for it).
    const vv = window.visualViewport
    const root = document.documentElement.style
    const fit = () => {
      if (!vv) return
      root.setProperty('--vv-top', `${vv.offsetTop}px`)
      root.setProperty('--vv-height', `${vv.height}px`)
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => {
      document.removeEventListener('keydown', onKey)
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      root.removeProperty('--vv-top')
      root.removeProperty('--vv-height')
      clearTimeout(t)
      prev?.focus?.()
    }
  }, [open, onClose, dismissible])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.target === e.currentTarget && dismissible && onClose()}
        >
          <motion.div
            ref={panel}
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={isDesktop ? { opacity: 0, scale: 0.96, y: 8 } : { y: '100%' }}
            animate={isDesktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={isDesktop ? { opacity: 0, scale: 0.97, y: 4 } : { y: '100%' }}
            transition={isDesktop ? { duration: 0.2, ease: [0.2, 0, 0, 1] } : SPRING}
          >
            {(title || dismissible) && (
              <div className="modal-sheet__head">
                <div className="modal-sheet__title" id={labelledBy}>
                  {title}
                </div>
                {dismissible && (
                  <IconButton label="Close" onClick={onClose}>
                    <X />
                  </IconButton>
                )}
              </div>
            )}
            <div className="modal-sheet__body">{children}</div>
            {footer && <div className="modal-sheet__footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Confirmation before destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Keep it',
  destructive,
  loading,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      dismissible={!loading}
      footer={
        <>
          <Button variant={destructive ? 'danger' : 'primary'} size="lg" block loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" size="lg" block onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
        </>
      }
    >
      <div className="stack gap-2" style={{ paddingTop: 4 }}>
        <h2 className="t-h2">{title}</h2>
        {body && <div className="t-body t-secondary">{body}</div>}
        {children}
      </div>
    </ModalSheet>
  )
}
