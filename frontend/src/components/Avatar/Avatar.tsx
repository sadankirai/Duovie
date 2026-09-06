interface AvatarProps {
  initial: string
  color: string
  size?: number
  statusColor?: string
  fontSize?: number
}

export default function Avatar({ initial, color, size = 40, statusColor, fontSize }: AvatarProps) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: fontSize ?? size * 0.36,
        }}
      >
        {initial}
      </div>
      {statusColor && (
        <div
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: size * 0.24,
            height: size * 0.24,
            borderRadius: '50%',
            background: statusColor,
            border: '2px solid var(--color-bg)',
          }}
        />
      )}
    </div>
  )
}
