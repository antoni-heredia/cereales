import { useState } from 'react';
import { useI18n } from '@/i18n';
import { engineName } from '@/lib/engines';
import type { TranscriptionEngine } from '@/types';

interface ServicePickerTabsProps {
  /** Readonly so the `TRANSCRIPTION_ENGINES` constant can be passed as it is. */
  engines: readonly TranscriptionEngine[];
  selected: TranscriptionEngine;
  hints: Record<TranscriptionEngine, string>;
  onSelect: (engine: TranscriptionEngine) => void;
  label: string;
}

/**
 * Service picker for Settings screen using tabs. Shows each transcription
 * service as a separate tab with its hint text visible.
 */
export function ServicePickerTabs({
  engines,
  selected,
  hints,
  onSelect,
  label,
}: ServicePickerTabsProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TranscriptionEngine>(selected);

  const getTabLabel = (engine: TranscriptionEngine): string => {
    return engine === 'local' ? t('settings.serviceLocal') : engineName(engine);
  };

  return (
    <div className="service-picker">
      <div className="service-picker-label">{label}</div>

      <div className="service-tabs" role="tablist">
        {engines.map((engine) => (
          <button
            key={engine}
            type="button"
            role="tab"
            aria-selected={engine === activeTab}
            aria-controls={`service-panel-${engine}`}
            id={`service-tab-${engine}`}
            className={`service-tab${engine === activeTab ? ' service-tab--active' : ''}`}
            onClick={() => {
              setActiveTab(engine);
              onSelect(engine);
            }}
          >
            {getTabLabel(engine)}
          </button>
        ))}
      </div>

      <div className="service-panels">
        {engines.map((engine) => (
          <div
            key={engine}
            role="tabpanel"
            id={`service-panel-${engine}`}
            aria-labelledby={`service-tab-${engine}`}
            className={`service-panel${engine === activeTab ? ' service-panel--active' : ''}`}
            hidden={engine !== activeTab}
          >
            <div className="service-panel-hint">{hints[engine]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
