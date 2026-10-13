import { Link } from 'react-router-dom'
import { ChevronLeft, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import ConnectionStatus from '@/components/ConnectionStatus'

/**
 * Header rendered by each screen, as the first child of the screen wrapper.
 *
 * Props:
 * - title: screen title
 * - subtitle: optional small line under the title
 * - back: optional path; shows a back button that links there
 * - avatar: optional node shown after the back button (e.g. a contact avatar)
 * - action: optional node on the right (e.g. an icon button)
 * - children: optional extra rows rendered under the title row, inside the
 *   same sticky bar (e.g. a search box and filter tabs)
 * - className: extra classes (e.g. "mb-4" on screens without space-y-4)
 *
 * It sticks to the top, bleeds to the screen edges (-mx-4) and cancels the
 * wrapper's top padding (-mt-4), assuming <main className="px-4"> and a
 * screen wrapper with py-4.
 */
function ScreenHeader({ title, subtitle, back, avatar, action, children, className }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 -mx-4 -mt-4 border-b border-border bg-background/95 px-4 backdrop-blur-xl',
        className
      )}
    >
      <div className="flex h-14 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {back && (
            <Link
              to={back}
              aria-label="Back"
              className="flex size-9 shrink-0 items-center justify-center rounded-[14px] transition-all hover:bg-muted"
            >
              <ChevronLeft size={22} className="text-foreground" />
            </Link>
          )}

          {avatar ??
            (!back && (
              <div
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-accent"
              >
                <MessageCircle size={20} className="text-foreground" />
              </div>
            ))}

          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-base font-semibold leading-5">{title}</h1>
            {subtitle && (
              <p className="truncate text-xs leading-4 text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ConnectionStatus />
          {action}
        </div>
      </div>

      {children}
    </header>
  )
}

export default ScreenHeader