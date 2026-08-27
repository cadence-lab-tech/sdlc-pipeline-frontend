import type {AnchorHTMLAttributes} from 'react';
import {useHref, useLinkClickHandler} from 'react-router-dom';

// Мост между ссылками Astryx и роутером: все href внутри LinkProvider уходят
// в клиентскую навигацию, а не в перезагрузку страницы.
export function RouterLink({href = '', onClick, children, ...props}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const external = /^[a-z]+:|^\/\//i.test(href);
  return external ? (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ) : (
    <InternalLink href={href} onClick={onClick} {...props}>
      {children}
    </InternalLink>
  );
}

function InternalLink({href = '', onClick, children, ...props}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const to = useHref(href);
  const navigate = useLinkClickHandler(href);
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) navigate(e);
      }}
      {...props}>
      {children}
    </a>
  );
}
