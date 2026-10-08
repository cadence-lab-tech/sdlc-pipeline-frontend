import {useEffect, useState} from 'react';

import {api} from '../api/client';
import type {Tenancy} from '../api/types';

// Сведения об инстансе (GET /v1/instance, CLAB-87) — то, что от загрузки к
// загрузке страницы не меняется: версия сборки и профиль. Поэтому, в
// отличие от остальных данных, ответ держится на уровне модуля: один запрос
// на загрузку страницы, общий для оболочки и страницы входа, которая живёт
// вне оболочки, — React-контекст их бы не связал.
//
// Сервер без ручки (404) или сбой запроса — профиль shared и неизвестная
// версия: интерфейс работает как до появления профилей, а строки версии нет.

export interface InstanceView {
  tenancy: Tenancy;
  // vX.Y.Z, SHA или dev; нет — сервер не ответил.
  version?: string;
}

const FALLBACK: InstanceView = {tenancy: 'shared'};

let pending: Promise<InstanceView> | undefined;
let known: InstanceView | undefined;

export function loadInstance(): Promise<InstanceView> {
  pending ??= api
    .instance()
    .then(
      // Профиль — только по tenancy: ни вид команд, ни is_admin его не
      // подменяют. Незнакомое значение — профиль по умолчанию.
      (i): InstanceView => ({tenancy: i.tenancy === 'single' ? 'single' : 'shared', version: i.version || undefined}),
      (): InstanceView => FALLBACK,
    )
    .then((view) => (known = view));
  return pending;
}

// undefined — ответ ещё не пришёл. Страницы, у которых от профиля зависит
// раскладка, ждут его, чтобы не мигать разделами общего инстанса.
export function useInstance(): InstanceView | undefined {
  const [view, setView] = useState(known);
  useEffect(() => {
    if (view) return;
    let live = true;
    void loadInstance().then((v) => {
      if (live) setView(v);
    });
    return () => {
      live = false;
    };
  }, [view]);
  return view;
}

export const isSingle = (view?: InstanceView) => view?.tenancy === 'single';

// Пустое состояние на выделенном инстансе для того, кого ещё никуда не
// позвали, — одно на «Командах» и «Проектах»: оба пути к доступу названы.
export const NO_ACCESS_HINT =
  'Доступ даёт команда: попросите у коллеги приглашение ссылкой или обратитесь к администратору инстанса.';
