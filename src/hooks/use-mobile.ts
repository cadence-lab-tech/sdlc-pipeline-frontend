import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

// Ширина окна читается в инициализаторе, а не эффектом: первый кадр иначе
// рисовался бы по неверной догадке и тут же перерисовывался.
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
