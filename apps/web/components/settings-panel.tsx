'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import * as m from 'motion/react-m';
import { useState, type ReactNode } from 'react';

import type { MotionLevel } from '@/lib/types';

import { useUiPreferences } from './app-providers';
import { Icons } from './icons';

export function SettingsPanel({ trigger }: { trigger?: ReactNode }) {
  const { preferences, setPreferences, tier } = useUiPreferences();
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <button aria-label="界面设置" className="icon-button" type="button">
            <Icons.settings />
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <m.div animate={{ opacity: 1 }} className="dialog-overlay" initial={{ opacity: 0 }} />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <m.section
            animate={{ opacity: 1, y: 0, scale: 1 }}
            aria-describedby="settings-description"
            className="settings-dialog ornate-panel"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 430, damping: 36 }}
          >
            <div className="panel-kicker">月夜偏好</div>
            <Dialog.Title>界面与感官设置</Dialog.Title>
            <Dialog.Description id="settings-description">
              动效会依据设备性能自动调整。当前运行档位：
              {tier === 'high' ? '流畅' : tier === 'medium' ? '均衡' : '轻量'}。
            </Dialog.Description>

            <fieldset className="settings-fieldset">
              <legend>动态效果</legend>
              <div className="segmented-control">
                {(
                  [
                    ['auto', '自动'],
                    ['high', '丰富'],
                    ['medium', '均衡'],
                    ['low', '轻量'],
                  ] as Array<[MotionLevel, string]>
                ).map(([value, label]) => (
                  <button
                    aria-pressed={preferences.motionLevel === value}
                    className={preferences.motionLevel === value ? 'active' : ''}
                    key={value}
                    onClick={() =>
                      setPreferences((current) => ({ ...current, motionLevel: value }))
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <SettingSwitch
              checked={preferences.soundEnabled}
              label="游戏音效"
              onCheckedChange={(soundEnabled) =>
                setPreferences((current) => ({ ...current, soundEnabled }))
              }
            />
            <SettingSwitch
              checked={preferences.hapticsEnabled}
              label="轻触反馈"
              onCheckedChange={(hapticsEnabled) =>
                setPreferences((current) => ({ ...current, hapticsEnabled }))
              }
            />

            <label className="volume-control">
              <span>音量</span>
              <input
                aria-label="音效音量"
                max="1"
                min="0"
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    masterVolume: Number(event.target.value),
                  }))
                }
                step="0.05"
                type="range"
                value={preferences.masterVolume}
              />
              <output>{Math.round(preferences.masterVolume * 100)}%</output>
            </label>

            <Dialog.Close asChild>
              <button aria-label="关闭设置" className="dialog-close" type="button">
                <Icons.close />
              </button>
            </Dialog.Close>
          </m.section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <Switch.Root
        aria-label={label}
        checked={checked}
        className="switch-root"
        onCheckedChange={onCheckedChange}
      >
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}
