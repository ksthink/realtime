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

// 별: 소원
export const WishIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9L12 2.5Z" />
  </Svg>
);

export const CameraIcon = (p: Props) => (
  <Svg {...p}>
    <path fillRule="evenodd" d="M9 4h6l1.6 2.5H20A2 2 0 0 1 22 8.5v9.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.4L9 4Zm3 13.5a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" />
  </Svg>
);

// 감자 실루엣: 둥근 몸통에 짧은 팔다리. 캐릭터 다시 빚기
export const SculptIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 2.5c4.2 0 7 2.9 7 6.7 0 3.9-2.9 6.8-7 6.800s-7-2.9-7-6.800c0-3.8 2.8-6.7 7-6.700Z" />
    <path d="M4.3 9.5 1.5 11.800l1.1 1.3 2.7-2-1-1.600ZM19.7 9.500l2.8 2.3-1.1 1.3-2.7-2 1-1.600Z" />
    <path d="M8.5 15.300h2.200v5H12v1.700H7.500v-1.700h1v-5ZM13.3 15.300h2.200v5h1v1.700H12v-1.700h1.300v-5Z" />
  </Svg>
);

// 드래그: 양쪽 화살표
export const DragIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12l5-5v3h10V7l5 5-5 5v-3H7v3l-5-5Z" />
  </Svg>
);

export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m6 4 6 6 6-6 2 2-6 6 6 6-2 2-6-6-6 6-2-2 6-6-6-6 2-2Z" />
  </Svg>
);
