'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useMemo, useRef, useState } from 'react';

import { isActiveProvider } from '@/lib/ai-models';
import {
  fetchAdminDashboard,
  updateAdminProvider,
  type AdminUsageSummary,
  type ProviderRecord,
  type UpdateProviderInput,
} from '@/lib/live-api';
import { motionTokens } from '@/lib/motion';

import { Icons } from './icons';
import { RouteTransitionLink } from './route-transition-link';
import { SettingsPanel } from './settings-panel';

type AdminDataMode = 'idle' | 'loading' | 'live' | 'error';

const providerColors: Record<string, string> = {
  deepseek: '#d8ad62',
  kimi: '#91b9d6',
};

const statusLabels: Record<ProviderRecord['status'], string> = {
  ready: '运行就绪',
  disabled: '已停用',
  'missing-credential': '缺少密钥',
  error: '运行异常',
};

function realProviders(records: readonly ProviderRecord[]): ProviderRecord[] {
  return records.filter(isActiveProvider);
}

export function AdminExperience() {
  const adminKeyRef = useRef<HTMLInputElement>(null);
  const providerTriggerRef = useRef<HTMLButtonElement>(null);
  const [providers, setProviders] = useState<readonly ProviderRecord[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>();
  const [adminKey, setAdminKey] = useState('');
  const [dataMode, setDataMode] = useState<AdminDataMode>('idle');
  const [usage, setUsage] = useState<AdminUsageSummary>();
  const [connectionMessage, setConnectionMessage] =
    useState('输入管理密钥以读取服务端真实配置与调用数据。');
  const [savingSlug, setSavingSlug] = useState<string>();
  const selected = providers.find((provider) => provider.slug === selectedSlug);
  const successRate =
    usage && usage.calls > 0 ? Math.round((usage.succeeded / usage.calls) * 100) : undefined;
  const fallbackNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );

  const loadDashboard = async () => {
    const key = adminKey.trim();
    if (!key || dataMode === 'loading') {
      if (!key) {
        setConnectionMessage('请输入管理 API 密钥。');
        adminKeyRef.current?.focus();
      }
      return;
    }
    setDataMode('loading');
    setConnectionMessage('正在读取服务端运行状态与用量…');
    try {
      const dashboard = await fetchAdminDashboard(key);
      const nextProviders = realProviders(dashboard.providers);
      setProviders(nextProviders);
      setUsage(dashboard.usage);
      setSelectedSlug((current) =>
        current && nextProviders.some((provider) => provider.slug === current)
          ? current
          : undefined,
      );
      setDataMode('live');
      setConnectionMessage(
        `已同步 ${nextProviders.length} 个可用供应商；数据生成于本次服务端请求。`,
      );
    } catch (error) {
      setProviders([]);
      setUsage(undefined);
      setSelectedSlug(undefined);
      setDataMode('error');
      setConnectionMessage(error instanceof Error ? error.message : '读取实时后台失败。');
    }
  };

  const disconnectAdmin = () => {
    setAdminKey('');
    setProviders([]);
    setUsage(undefined);
    setSelectedSlug(undefined);
    setDataMode('idle');
    setConnectionMessage('已清除当前会话管理密钥；尚未读取后台数据。');
  };

  const mutateProvider = async (
    provider: ProviderRecord,
    input: UpdateProviderInput,
  ): Promise<boolean> => {
    const key = adminKey.trim();
    if (!key || savingSlug) return false;
    setSavingSlug(provider.slug);
    setConnectionMessage(`正在保存 ${provider.name} 的真实配置…`);
    try {
      const updated = await updateAdminProvider(key, provider.slug, input);
      setProviders((current) =>
        current.map((item) => (item.slug === provider.slug ? updated : item)),
      );
      setDataMode('live');
      setConnectionMessage(`${provider.name} 配置已由服务端确认保存。`);
      return true;
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : '服务端未接受配置更新。');
      return false;
    } finally {
      setSavingSlug(undefined);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) setSelectedSlug(undefined);
      }}
      open={Boolean(selected)}
    >
      <m.main
        animate={{ opacity: 1, y: 0 }}
        className="admin-page"
        id="main-content"
        initial={{ opacity: 0, y: 10 }}
        transition={motionTokens.phase}
      >
        <div className="admin-background" aria-hidden="true" />
        <header className="admin-header">
          <RouteTransitionLink className="brand" href="/">
            <span className="brand-mark">
              <Icons.wolf size={27} />
            </span>
            <span className="brand-name">狼人杀</span>
            <small>控制台</small>
          </RouteTransitionLink>
          <div className="admin-header-actions">
            <span className={`system-status system-status--${dataMode}`}>
              <i aria-hidden="true" />
              {dataMode === 'live'
                ? '实时后台'
                : dataMode === 'loading'
                  ? '同步中…'
                  : dataMode === 'error'
                    ? '连接异常'
                    : '尚未连接'}
            </span>
            <SettingsPanel />
          </div>
        </header>

        <aside className="admin-nav">
          <div className="admin-profile">
            <span>
              <Icons.user />
            </span>
            <div>
              <strong>站点管理员</strong>
              <small>当前浏览器会话</small>
            </div>
          </div>
          <nav aria-label="管理后台">
            <a aria-current="page" className="active" href="#models">
              <Icons.bot />
              模型管理
            </a>
            <a href="#usage">
              <span aria-hidden="true" className="nav-symbol">
                ▥
              </span>
              用量统计
            </a>
            <span aria-disabled="true" className="admin-nav-static">
              <Icons.shield />
              安全状态
            </span>
            <span aria-disabled="true" className="admin-nav-static">
              <Icons.settings />
              运行设置
            </span>
          </nav>
          <RouteTransitionLink className="back-to-game" href="/">
            ← 返回游戏
          </RouteTransitionLink>
        </aside>

        <section className="admin-content" id="models">
          <div className="admin-title">
            <div>
              <p className="panel-kicker">AI Provider Hub</p>
              <h1>模型管理</h1>
              <p>这里只展示实际对局启用的 DeepSeek 与 Kimi，不生成演示记录。</p>
            </div>
            <button
              className="primary-button"
              data-testid="admin-refresh"
              disabled={dataMode === 'loading' || !adminKey.trim()}
              onClick={() => void loadDashboard()}
              type="button"
            >
              {dataMode === 'loading' ? '正在同步…' : '刷新实时数据'}
            </button>
          </div>

          <form
            aria-label="实时后台连接"
            className={`admin-connection admin-connection--${dataMode}`}
            data-testid="admin-data-source"
            onSubmit={(event) => {
              event.preventDefault();
              void loadDashboard();
            }}
          >
            <div>
              <span className="admin-source-badge">{dataMode === 'live' ? 'LIVE' : 'SERVER'}</span>
              <p aria-live="polite">{connectionMessage}</p>
            </div>
            <label>
              <span className="sr-only">管理 API 密钥</span>
              <input
                autoComplete="off"
                data-testid="admin-key"
                disabled={dataMode === 'loading'}
                name="adminKey"
                onChange={(event) => setAdminKey(event.target.value)}
                placeholder="输入当前会话管理密钥…"
                spellCheck={false}
                type="password"
                value={adminKey}
                ref={adminKeyRef}
              />
            </label>
            {dataMode === 'live' ? (
              <button
                className="ghost-button compact-button"
                onClick={disconnectAdmin}
                type="button"
              >
                断开
              </button>
            ) : (
              <button
                className="secondary-button compact-button"
                disabled={dataMode === 'loading'}
                type="submit"
              >
                {dataMode === 'loading' ? '连接中…' : '读取实时后台'}
              </button>
            )}
          </form>

          <div className="metric-grid" id="usage">
            <MetricCard
              icon="◷"
              label="今日调用"
              suffix="次"
              value={usage ? usage.calls.toLocaleString() : '—'}
            />
            <MetricCard
              icon="◎"
              label="费用估算"
              {...(usage ? { prefix: '¥' } : {})}
              suffix={usage ? '元' : ''}
              value={usage ? (usage.costCents / 100).toFixed(2) : '—'}
            />
            <MetricCard
              icon="◇"
              label="成功率"
              suffix={successRate === undefined ? '' : '%'}
              value={successRate === undefined ? '—' : String(successRate)}
            />
            <MetricCard
              icon="⌁"
              label="平均响应"
              suffix={usage ? 'ms' : ''}
              value={usage ? usage.averageLatencyMs.toLocaleString() : '—'}
            />
          </div>

          <section className="provider-table ornate-panel">
            <div className="provider-table-head">
              <span>供应商 / 模型</span>
              <span>状态</span>
              <span>并发</span>
              <span>备用模型</span>
              <span>今日运行记录</span>
              <span>操作</span>
            </div>
            {providers.map((provider, index) => (
              <m.article
                animate={{ opacity: 1, y: 0 }}
                className="provider-row"
                data-testid={`admin-provider-${provider.slug}`}
                initial={{ opacity: 0, y: 8 }}
                key={provider.slug}
                transition={{ ...motionTokens.standard, delay: index * 0.04 }}
              >
                <div className="provider-name">
                  <span
                    aria-hidden="true"
                    style={
                      {
                        '--provider-color':
                          providerColors[provider.slug] ?? providerColors.deepseek,
                      } as React.CSSProperties
                    }
                  >
                    {provider.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{provider.name}</strong>
                    <small>{provider.modelId}</small>
                  </div>
                </div>
                <label
                  className={`provider-toggle provider-status--${provider.status}`}
                  data-disabled={
                    savingSlug !== undefined || !provider.configured ? 'true' : 'false'
                  }
                  htmlFor={`provider-${provider.slug}-enabled`}
                >
                  <Switch.Root
                    aria-label={`${provider.name} 启用状态`}
                    checked={provider.enabled}
                    className="switch-root"
                    disabled={savingSlug !== undefined || !provider.configured}
                    id={`provider-${provider.slug}-enabled`}
                    onCheckedChange={(enabled) => void mutateProvider(provider, { enabled })}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                  <span>{statusLabels[provider.status]}</span>
                </label>
                <label className="concurrency-input">
                  <input
                    aria-label={`${provider.name} 并发数`}
                    disabled={savingSlug !== undefined}
                    inputMode="numeric"
                    max={100}
                    min={1}
                    name={`${provider.slug}-concurrency`}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isInteger(next) && next !== provider.concurrencyLimit) {
                        void mutateProvider(provider, { concurrencyLimit: next });
                      }
                    }}
                    type="number"
                    defaultValue={provider.concurrencyLimit}
                  />
                </label>
                <div className="fallback-select">
                  {provider.fallbackProviderId
                    ? (fallbackNames.get(provider.fallbackProviderId) ??
                      provider.fallbackProviderId)
                    : '未配置'}
                </div>
                <div className="usage-cell">
                  <strong>
                    {provider.usage.calls.toLocaleString()} 次 · 估算 ¥
                    {(provider.usage.costCents / 100).toFixed(2)}
                  </strong>
                  <small>
                    成功 {provider.usage.succeeded} · 失败 {provider.usage.failed} · 平均{' '}
                    {provider.usage.averageLatencyMs}ms
                  </small>
                </div>
                <button
                  aria-label={`配置 ${provider.name}`}
                  className="row-settings"
                  onClick={(event) => {
                    providerTriggerRef.current = event.currentTarget;
                    setSelectedSlug(provider.slug);
                  }}
                  type="button"
                >
                  <Icons.settings />
                </button>
              </m.article>
            ))}
            {providers.length === 0 ? (
              <div className="admin-empty-state" data-testid="admin-empty-state">
                <Icons.bot size={28} />
                <strong>
                  {dataMode === 'live' ? '服务端没有返回可用供应商' : '尚未读取真实供应商数据'}
                </strong>
                <span>
                  {dataMode === 'error'
                    ? '请检查管理密钥与服务状态后重试。'
                    : '连接后台后，这里只显示 DeepSeek 与 Kimi 的真实状态。'}
                </span>
              </div>
            ) : null}
          </section>
          <p className="admin-footnote">
            管理密钥仅保存在当前 React 会话；供应商密钥由服务端管理，浏览器只接收掩码。
            费用按供应商返回的 token 与站点单价估算；未配置单价时使用保守预算值，不等同于
            供应商账单。
          </p>
        </section>
      </m.main>

      <AnimatePresence>
        {selected ? (
          <ProviderDialog
            key={selected.slug}
            onSave={(input) => mutateProvider(selected, input)}
            provider={selected}
            returnFocusRef={providerTriggerRef}
            saving={savingSlug === selected.slug}
          />
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function ProviderDialog({
  onSave,
  provider,
  returnFocusRef,
  saving,
}: {
  onSave: (input: UpdateProviderInput) => Promise<boolean>;
  provider: ProviderRecord;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  saving: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [concurrencyLimit, setConcurrencyLimit] = useState(provider.concurrencyLimit);
  const [timeoutMs, setTimeoutMs] = useState(provider.timeoutMs);
  const [dailyBudgetCents, setDailyBudgetCents] = useState(provider.dailyBudgetCents);

  return (
    <Dialog.Portal forceMount>
      <Dialog.Overlay asChild forceMount>
        <m.div
          animate={{ opacity: 1 }}
          className="admin-provider-overlay"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={motionTokens.instant}
        />
      </Dialog.Overlay>
      <Dialog.Content
        asChild
        forceMount
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <m.aside
          animate={{ opacity: 1, x: 0 }}
          aria-busy={saving}
          className="provider-drawer"
          data-testid="admin-provider-dialog"
          exit={{ opacity: 0, x: 28 }}
          initial={{ opacity: 0, x: 28 }}
          transition={motionTokens.spring}
        >
          <Dialog.Close asChild>
            <button aria-label="关闭供应商配置" className="dialog-close" type="button">
              <Icons.close />
            </button>
          </Dialog.Close>
          <Dialog.Description className="sr-only">
            更新 {provider.name} 的服务地址、密钥、请求超时、并发与每日费用上限。
          </Dialog.Description>
          <p className="panel-kicker">真实运行配置</p>
          <div aria-hidden="true" className="provider-emblem">
            <Icons.bot size={42} />
          </div>
          <Dialog.Title>{provider.name}</Dialog.Title>
          <span
            className={`encrypted-note encrypted-note--${provider.configured ? 'ready' : 'missing'}`}
          >
            <Icons.shield size={15} />
            {provider.configured ? `密钥已配置 · ${provider.maskedApiKey}` : '尚未配置供应商密钥'}
          </span>
          <label className="form-field">
            <span>当前模型</span>
            <div className="input-shell">
              <input autoComplete="off" name="providerModel" readOnly value={provider.modelId} />
            </div>
          </label>
          <label className="form-field">
            <span>API 地址</span>
            <div className="input-shell">
              <input
                autoComplete="url"
                name="providerBaseUrl"
                onChange={(event) => setBaseUrl(event.target.value)}
                spellCheck={false}
                value={baseUrl}
              />
            </div>
          </label>
          <label className="form-field">
            <span>更新 API 密钥（留空则不变）</span>
            <div className="input-shell">
              <input
                autoComplete="new-password"
                name="providerKey"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={provider.configured ? provider.maskedApiKey : '输入真实供应商密钥'}
                spellCheck={false}
                type="password"
                value={apiKey}
              />
            </div>
          </label>
          <label className="form-field">
            <span>请求超时（毫秒）</span>
            <div className="input-shell">
              <input
                inputMode="numeric"
                min={1_000}
                name="providerTimeout"
                onChange={(event) => setTimeoutMs(Number(event.target.value))}
                type="number"
                value={timeoutMs}
              />
            </div>
          </label>
          <label className="form-field">
            <span>并发上限</span>
            <div className="input-shell">
              <input
                inputMode="numeric"
                min={1}
                name="providerConcurrency"
                onChange={(event) => setConcurrencyLimit(Number(event.target.value))}
                type="number"
                value={concurrencyLimit}
              />
            </div>
          </label>
          <label className="form-field">
            <span>每日费用上限（分，0 表示不限）</span>
            <div className="input-shell">
              <input
                inputMode="numeric"
                min={0}
                name="providerBudget"
                onChange={(event) => setDailyBudgetCents(Number(event.target.value))}
                type="number"
                value={dailyBudgetCents}
              />
            </div>
          </label>
          <div className="drawer-divider" />
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => {
              const input: UpdateProviderInput = {
                baseUrl: baseUrl.trim(),
                concurrencyLimit,
                timeoutMs,
                dailyBudgetCents,
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              };
              void onSave(input).then((accepted) => {
                if (accepted) setApiKey('');
              });
            }}
            type="button"
          >
            {saving ? '服务端保存中…' : '保存真实配置'}
          </button>
        </m.aside>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function MetricCard({
  icon,
  label,
  prefix,
  suffix,
  value,
}: {
  icon: string;
  label: string;
  prefix?: string;
  suffix: string;
  value: string;
}) {
  return (
    <article className="metric-card ornate-panel">
      <span aria-hidden="true" className="metric-icon">
        {icon}
      </span>
      <div>
        <small>{label}</small>
        <strong>
          {prefix}
          <b>{value}</b> <i>{suffix}</i>
        </strong>
      </div>
    </article>
  );
}
