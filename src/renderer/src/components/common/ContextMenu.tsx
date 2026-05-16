import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  hasSubmenu?: boolean
  submenuItems?: MenuItem[]
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // 计算位置防止溢出屏幕
  const style: React.CSSProperties = {
    left: x,
    top: y,
  }

  const handleItemHover = (item: MenuItem, e: React.MouseEvent<HTMLButtonElement>) => {
    if (item.hasSubmenu && item.submenuItems) {
      const rect = e.currentTarget.getBoundingClientRect()
      setSubmenuPosition({ x: rect.right + 4, y: rect.top })
      setActiveSubmenu(item.id)
    } else {
      setActiveSubmenu(null)
    }
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-dark-700 border border-dark-500 rounded-lg shadow-xl py-1 min-w-[180px] animate-fade-in"
      style={style}
      onMouseLeave={() => setActiveSubmenu(null)}
    >
      {items.map((item) => (
        <div key={item.id} className="relative">
          <button
            disabled={item.disabled}
            onClick={() => {
              if (!item.hasSubmenu) {
                item.onClick()
                onClose()
              }
            }}
            onMouseEnter={(e) => handleItemHover(item, e)}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
              item.disabled
                ? 'text-dark-300 cursor-not-allowed'
                : item.danger
                  ? 'text-red-400 hover:bg-red-400/10'
                  : 'text-dark-100 hover:bg-dark-600 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {item.icon && <span className="text-dark-300">{item.icon}</span>}
              <span>{item.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {item.shortcut && (
                <span className="text-[11px] text-dark-300">{item.shortcut}</span>
              )}
              {item.hasSubmenu && (
                <svg className="w-4 h-4 text-dark-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          </button>

          {/* 子菜单 */}
          {item.hasSubmenu && item.submenuItems && activeSubmenu === item.id && (
            <div
              className="fixed z-[101] bg-dark-700 border border-dark-500 rounded-lg shadow-xl py-1 min-w-[160px] animate-fade-in"
              style={{ left: submenuPosition.x, top: submenuPosition.y }}
              onMouseEnter={() => setActiveSubmenu(item.id)}
            >
              {item.submenuItems.map((subItem) => (
                <button
                  key={subItem.id}
                  disabled={subItem.disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    subItem.onClick()
                    onClose()
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    subItem.disabled
                      ? 'text-dark-300 cursor-not-allowed'
                      : subItem.danger
                        ? 'text-red-400 hover:bg-red-400/10'
                        : 'text-dark-100 hover:bg-dark-600 hover:text-white'
                  }`}
                >
                  {subItem.icon && <span className="text-dark-300">{subItem.icon}</span>}
                  <span>{subItem.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
