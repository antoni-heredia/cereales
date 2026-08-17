import { useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { engineName } from '@/lib/engines';
import type { TranscriptionEngine } from '@/types';

interface ServiceTabContent {
  engine: TranscriptionEngine;
  hint: string;
  content: ReactNode;
}

interface ServicePickerTabsProps {
  tabs: ServiceTabContent[];
  selected: TranscriptionEngine;
  onSelect: (engine: TranscriptionEngine) => void;
  label: string;
}

/**
 * Service picker for Settings screen using tabs. Each tab contains its
 * service description, configuration fields, and actions.
 */
export function ServicePickerTabs({
  tabs,
  selected,
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
        {tabs.map((tab) => (
          <button
            key={tab.engine}
            type="button"
            role="tab"
            aria-selected={tab.engine === activeTab}
            aria-controls={`service-panel-${tab.engine}`}
            id={`service-tab-${tab.engine}`}
            className={`service-tab${tab.engine === activeTab ? ' service-tab--active' : ''}`}
            onClick={() => {
              setActiveTab(tab.engine);
              onSelect(tab.engine);
            }}
          >
            {getTabLabel(tab.engine)}
          </button>
        ))}
      </div>

      <div className="service-panels">
        {tabs.map((tab) => (
          <div
            key={tab.engine}
            role="tabpanel"
            id={`service-panel-${tab.engine}`}
            aria-labelledby={`service-tab-${tab.engine}`}
            className={`service-panel${tab.engine === activeTab ? ' service-panel--active' : ''}`}
            hidden={tab.engine !== activeTab}
          >
            <div className="service-panel-hint">{tab.hint}</div>
            <div className="service-panel-content">{tab.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
