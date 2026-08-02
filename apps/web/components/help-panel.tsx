'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as m from 'motion/react-m';

import { Icons } from './icons';

export function HelpPanel() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button aria-label="游戏帮助" className="icon-button" type="button">
          ?
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <m.div animate={{ opacity: 1 }} className="dialog-overlay" initial={{ opacity: 0 }} />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <m.section
            animate={{ opacity: 1, y: 0, scale: 1 }}
            aria-describedby="help-description"
            className="settings-dialog help-dialog ornate-panel"
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 430, damping: 36 }}
          >
            <p className="panel-kicker">快速帮助</p>
            <Dialog.Title>如何开始一局</Dialog.Title>
            <Dialog.Description id="help-description">
              真人可以用房间码加入，空座由 DeepSeek 或 Kimi 补齐；AI 观战局则由所有 AI
              自动完成对局。
            </Dialog.Description>
            <ol className="help-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>选择模式</strong>
                  <small>创建、加入或观看 AI 全自动对局。</small>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>确认座位</strong>
                  <small>房主选择人数、模型与性格后开局。</small>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>按阶段行动</strong>
                  <small>只可选择服务器给出的合法目标，身份和夜间行动保持私密。</small>
                </div>
              </li>
            </ol>
            <p className="help-note">“本地演示”仅用于预览界面；真正对局会明确标记为“实时连接”。</p>
            <Dialog.Close asChild>
              <button aria-label="关闭帮助" className="dialog-close" type="button">
                <Icons.close />
              </button>
            </Dialog.Close>
          </m.section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
