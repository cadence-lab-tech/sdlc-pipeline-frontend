import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import {
  BarChart3,
  Columns3,
  FolderKanban,
  LogOut,
  Moon,
  Search,
  Settings2,
  Sun,
  Users,
  UserSquare,
  Workflow,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import {
  ApiError,
  UNAUTHENTICATED_EVENT,
  api,
  currentToken,
  setCurrentToken,
} from "./api/client";
import type { Me, ProjectHealth } from "./api/types";
import { Failure, Loading } from "./components/Feedback";
import {
  PROJECT_HEALTH_EVENT,
  healthMarks,
  type HealthMarks,
} from "./components/health";
import { Principals, Teams } from "./pages/Admin";
import { Board } from "./pages/Board";
import { CLILogin, CLI_LOGIN_PATH } from "./pages/CLILogin";
import { GITHUB_RETURN_PATH, Login } from "./pages/Login";
import { GitHubConnect } from "./pages/GitHubConnect";
import { GITHUB_CONNECT_PATH } from "./api/github";
import { useInstance } from "./hooks/useInstance";
import { INVITE_PATH, Invite } from "./pages/Invite";
import { Knowledge } from "./pages/Knowledge";
import { Metrics } from "./pages/Metrics";
import { Projects } from "./pages/Projects";
import { Roles } from "./pages/Roles";
import { Settings } from "./pages/Settings";
import { TaskDetail } from "./pages/TaskDetail";
import { WorkflowEditor } from "./pages/WorkflowEditor";

export function App() {
  return (
    <ThemeProvider>
      {/* Подсказки Radix требуют провайдера над собой — он один на всё
          приложение, а не по одному на каждую подсказку. */}
      <TooltipProvider delayDuration={300}>
        {/* Тосты об успехе — один Toaster на всё приложение, вне Routes:
            они нужны и страницам вне оболочки. Ошибки в тосты не ходят —
            они остаются рядом с формой, в Failure. */}
        <Toaster position="bottom-right" closeButton />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path={GITHUB_RETURN_PATH} element={<Login />} />
            <Route path={CLI_LOGIN_PATH} element={<CLILogin />} />
            {/* Приём приглашения вне оболочки: у только что вошедшего нет
                проектов, а вход он проходит сам (решение 0035). */}
            <Route path={INVITE_PATH} element={<Invite />} />
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route
              path="/projects"
              element={
                <Shell page="projects">
                  <Projects />
                </Shell>
              }
            />
            <Route
              path="/teams"
              element={
                <Shell page="teams">
                  <Teams />
                </Shell>
              }
            />
            <Route
              path="/principals"
              element={
                <Shell page="principals">
                  <Principals />
                </Shell>
              }
            />
            {/* Возврат от GitHub после установки приложения и повторной
                авторизации (решение 0034): адрес зарегистрирован у приложения
                как callback и Setup URL. */}
            <Route
              path={GITHUB_CONNECT_PATH}
              element={
                <Shell page="github">
                  <GitHubConnect />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey"
              element={<Navigate to="board" replace />}
            />
            <Route
              path="/p/:projectKey/board"
              element={
                <Shell page="board">
                  <Board />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey/roles"
              element={
                <Shell page="roles">
                  <Roles />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey/workflow"
              element={
                <Shell page="workflow">
                  <WorkflowEditor />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey/search"
              element={
                <Shell page="search">
                  <Knowledge />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey/metrics"
              element={
                <Shell page="metrics">
                  <Metrics />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey/settings"
              element={
                <Shell page="settings">
                  <Settings />
                </Shell>
              }
            />
            <Route
              path="/p/:projectKey/tasks/:taskKey"
              element={
                <Shell page="board">
                  <TaskDetail />
                </Shell>
              }
            />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}

type Page =
  | "projects"
  | "teams"
  | "principals"
  | "github"
  | "board"
  | "roles"
  | "workflow"
  | "search"
  | "metrics"
  | "settings";

const TITLES: Record<Page, string> = {
  projects: "Проекты",
  teams: "Команды",
  principals: "Принципалы",
  github: "Подключение GitHub",
  board: "Доска",
  roles: "Роли",
  workflow: "Цикл",
  search: "Поиск",
  metrics: "Метрики",
  settings: "Настройки",
};

// Shell спрашивает бэкенд, кто мы, и в режиме токенов без действующего токена
// уводит на вход. В режиме header формы входа нет: актор назван заголовком,
// и проверять там нечего.
function Shell({ page, children }: { page: Page; children: React.ReactNode }) {
  const { projectKey } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Me>();
  const [failed, setFailed] = useState<ApiError>();

  useEffect(() => {
    let live = true;
    api.me().then(
      (who) => live && setMe(who),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.code === "unauthenticated") {
          navigate("/login", {
            replace: true,
            state: { from: location.pathname },
          });
          return;
        }
        setFailed(
          err instanceof ApiError ? err : new ApiError("internal", String(err)),
        );
      },
    );
    return () => {
      live = false;
    };
    // Проверка идёт один раз на монтирование оболочки, а не на каждую смену пути.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Сводка состояния проекта — отметки в боковом меню (CLAB-79). Оболочка
  // одна на все страницы проекта, поэтому отметку видит и тот, кто пришёл по
  // ссылке сразу в карточку задачи. Запрос уходит при входе на страницу
  // проекта, на каждом переходе между его страницами и по событию от страницы
  // («Проверить доступ»); таймера нет. Страница сводку не ждёт: ответ придёт —
  // отметки появятся, не придёт — их просто нет.
  const [health, setHealth] = useState<{ key: string; data?: ProjectHealth }>();
  const [healthTick, setHealthTick] = useState(0);
  useEffect(() => {
    if (!projectKey) return;
    let live = true;
    void api.projectHealth(projectKey).then((data) => {
      if (live) setHealth({ key: projectKey, data });
    });
    return () => {
      live = false;
    };
  }, [projectKey, location.pathname, healthTick]);
  useEffect(() => {
    const refresh = () => setHealthTick((n) => n + 1);
    window.addEventListener(PROJECT_HEALTH_EVENT, refresh);
    return () => window.removeEventListener(PROJECT_HEALTH_EVENT, refresh);
  }, []);
  // Сводка чужого проекта — не про этот: после перехода в другой проект
  // прежние отметки не показываются, пока не придёт его собственная.
  const marks =
    projectKey && health?.key === projectKey ? healthMarks(health.data) : {};
  const menuMark = [marks.settings, marks.search].filter(Boolean).join(". ");

  // Любой 401 посреди работы — токен отозван или истёк — возвращает на вход.
  useEffect(() => {
    const onUnauthenticated = () => {
      setCurrentToken(null);
      navigate("/login", { replace: true, state: { from: location.pathname } });
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () =>
      window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [navigate, location.pathname]);

  // Выход отзывает сессию на бэкенде: забыть токен в браузере мало — тот же
  // токен остался бы действующим. Отказ игнорируем: не отозвалась сессия —
  // уводить со страницы всё равно нужно.
  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // токен мог протухнуть сам — тогда отзывать уже нечего
    }
    setCurrentToken(null);
    navigate("/login", { replace: true });
  };

  return (
    <SidebarProvider>
      <Nav
        page={page}
        projectKey={projectKey}
        me={me}
        marks={marks}
        onLogout={logout}
      />
      <SidebarInset className="min-w-0 overflow-x-hidden">
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          {/* На узком экране меню спрятано за этой кнопкой, и отметка стоит
              на ней: иначе её не увидеть, не открыв меню. */}
          <span className="relative inline-flex">
            <SidebarTrigger />
            {menuMark ? (
              <>
                <MarkDot data-menu-mark className="md:hidden" />
                <span className="sr-only md:hidden">{menuMark}</span>
              </>
            ) : null}
          </span>
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm font-medium">
            {projectKey ? `${projectKey} · ${TITLES[page]}` : TITLES[page]}
          </span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        {failed ? (
          <div className="p-6">
            <Failure error={failed} title="Сервис недоступен" />
          </div>
        ) : me ? (
          children
        ) : (
          <Loading />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

type NavEntry = {
  page: Page;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  // Отметка у пункта: текст для подсказки и программ чтения с экрана.
  mark?: string;
};

// MarkDot — точка-отметка. Цвет — токен темы destructive, он меняется вместе
// с темой; кольцо цветом фона отделяет точку от иконки.
function MarkDot({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-destructive ring-background pointer-events-none absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2",
        className,
      )}
      {...props}
    />
  );
}

function Nav({
  page,
  projectKey,
  me,
  marks,
  onLogout,
}: {
  page: Page;
  projectKey?: string;
  me?: Me;
  marks: HealthMarks;
  onLogout: () => void;
}) {
  // Версия сервера — из /v1/instance, общего со страницей входа. Старый
  // сервер без ручки или сбой — строки нет.
  const instance = useInstance();
  const global: NavEntry[] = [
    {
      page: "projects",
      label: "Проекты",
      icon: FolderKanban,
      href: "/projects",
    },
    // Команды живут над проектами: уровень доступа сразу в несколько,
    // владение и бюджет (решение 0027).
    { page: "teams", label: "Команды", icon: Users, href: "/teams" },
  ];
  if (me?.principal.is_admin) {
    global.push({
      page: "principals",
      label: "Принципалы",
      icon: UserSquare,
      href: "/principals",
    });
  }

  const inProject: NavEntry[] = projectKey
    ? [
        {
          page: "board",
          label: "Доска",
          icon: Columns3,
          href: `/p/${projectKey}/board`,
        },
        {
          page: "roles",
          label: "Роли",
          icon: UserSquare,
          href: `/p/${projectKey}/roles`,
        },
        {
          page: "workflow",
          label: "Цикл",
          icon: Workflow,
          href: `/p/${projectKey}/workflow`,
        },
        {
          page: "search",
          label: "Поиск",
          icon: Search,
          href: `/p/${projectKey}/search`,
          mark: marks.search,
        },
        {
          page: "metrics",
          label: "Метрики",
          icon: BarChart3,
          href: `/p/${projectKey}/metrics`,
        },
        {
          page: "settings",
          label: "Настройки",
          icon: Settings2,
          href: `/p/${projectKey}/settings`,
          mark: marks.settings,
        },
      ]
    : [];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/projects">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Wrench className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Cadence Lab</span>
                  <span className="text-muted-foreground truncate text-xs">
                    цикл разработки
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {global.map((item) => (
                <NavItem
                  key={item.page}
                  {...item}
                  isActive={page === item.page}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {inProject.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>{projectKey}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {inProject.map((item) => (
                  <NavItem
                    key={item.page}
                    {...item}
                    isActive={page === item.page}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      {me ? (
        <SidebarFooter>
          <div className="group-data-[collapsible=icon]:hidden space-y-1 px-2 py-1 text-xs">
            <p className="font-medium">
              {me.principal.kind}:{me.principal.handle}
              {me.principal.is_admin ? " · администратор" : ""}
            </p>
            {me.teams.length > 0 ? (
              <p className="text-muted-foreground">
                команды: {me.teams.map((t) => t.team_key).join(", ")}
              </p>
            ) : null}
            <p className="text-muted-foreground">
              {me.mode === "token"
                ? "вход по токену"
                : "режим отладки: актор из заголовка"}
            </p>
            {instance?.version ? (
              <p className="text-muted-foreground">
                сервер {instance.version}
              </p>
            ) : null}
          </div>
          {me.mode === "token" || currentToken() ? (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onLogout} tooltip="Выйти">
                  <LogOut />
                  <span>Выйти</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : null}
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}

function NavItem({
  label,
  href,
  icon: Icon,
  isActive,
  mark,
}: {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  mark?: string;
}) {
  const { state, isMobile } = useSidebar();
  // У свёрнутого до иконок меню подсказку пункта показывает сам компонент
  // меню — в неё попадает и текст отметки. У развёрнутого его подсказка
  // выключена, и текст отметки несёт обычный title.
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={mark ? `${label} — ${mark}` : label}
      >
        <Link
          to={href}
          data-nav-mark={mark ? "" : undefined}
          title={mark && !collapsed ? mark : undefined}
        >
          {/* Отметка стоит на иконке, а не справа от подписи: иконка остаётся
              на экране и когда меню свёрнуто. */}
          <span className="relative inline-flex shrink-0">
            <Icon className="size-4" />
            {mark ? <MarkDot className="ring-sidebar" /> : null}
          </span>
          <span>
            {label}
            {mark ? <span className="sr-only"> — {mark}</span> : null}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// Переключатель темы гоняет по кругу: светлая → тёмная → системная.
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next =
    theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const title = {
    light: "Тема: светлая",
    dark: "Тема: тёмная",
    system: "Тема: системная",
  }[theme];
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      title={title}
      aria-label={title}
    >
      {theme === "dark" ? (
        <Moon />
      ) : theme === "light" ? (
        <Sun />
      ) : (
        <Sun className="opacity-50" />
      )}
    </Button>
  );
}
