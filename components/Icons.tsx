// HUD 아이콘. 색은 currentColor를 따른다
type Props = { size?: number };

function Svg({ size = 18, children }: Props & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

// 위로 갈수록 작아지는 돌 세 개
export const TowerIcon = (p: Props) => (
  <Svg {...p}>
    <ellipse cx="12" cy="19.2" rx="10" ry="3" />
    <ellipse cx="11.3" cy="12.6" rx="7" ry="2.7" />
    <ellipse cx="12.6" cy="6.4" rx="4.4" ry="2.4" />
  </Svg>
);

export const PersonIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="7.5" r="4.5" />
    <path d="M3.5 21c0-4.7 3.8-7.5 8.5-7.5s8.5 2.8 8.5 7.5c0 .6-.4 1-1 1h-15c-.6 0-1-.4-1-1Z" />
  </Svg>
);

export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <path fillRule="evenodd" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19ZM13 7h-2v6l4.6 2.8 1-1.7L13 11.9V7Z" />
  </Svg>
);

const Stone = () => <ellipse cx="12" cy="18" rx="8.5" ry="4" />;

// 돌 위로 향하는 화살표: 줍기
export const PickIcon = (p: Props) => (
  <Svg {...p}>
    <Stone />
    <path d="M12 2.5 17 8h-3.5v4.5h-3V8H7l5-5.5Z" />
  </Svg>
);

// 돌 위의 깃발: 여기에 첫돌 놓기
export const FirstStoneIcon = (p: Props) => (
  <Svg {...p}>
    <Stone />
    <path d="M10.5 2.5h2v12h-2z" />
    <path d="M12.5 3 19 6.2l-6.5 3.2V3Z" />
  </Svg>
);

// 탑 위에 더하기: 내 탑에 쌓기
export const StackIcon = (p: Props) => (
  <Svg {...p}>
    <ellipse cx="10" cy="18.5" rx="8.5" ry="3.8" />
    <ellipse cx="10" cy="11.8" rx="5.8" ry="2.8" />
    <path d="M17.5 2.5h2.5V5h2.5v2.5H20V10h-2.5V7.5H15V5h2.5V2.5Z" />
  </Svg>
);

// 돌 위의 X: 여기서 놓으면 버려짐
export const DiscardIcon = (p: Props) => (
  <Svg {...p}>
    <Stone />
    <path d="m8.2 2.5 3.8 3.8 3.8-3.8 1.9 1.9-3.8 3.8 3.8 3.8-1.9 1.9-3.8-3.8-3.8 3.8-1.9-1.9 3.8-3.8-3.8-3.8 1.9-1.9Z" />
  </Svg>
);

// 맞댄 두 손: 합장
export const PrayIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M11.2 2.5v13.2L7.4 21.5H3.2l2.6-5.6 1.8-8.6c.2-.9.8-1.3 1.3-1.3l.5 3.5.4-6.2c.1-.5.9-.8 1.4-.8Z" />
    <path d="M12.8 2.5v13.2l3.8 5.8h4.2l-2.6-5.6-1.8-8.6c-.2-.9-.8-1.3-1.3-1.3l-.5 3.5-.4-6.2c-.1-.5-.9-.8-1.4-.8Z" />
  </Svg>
);
