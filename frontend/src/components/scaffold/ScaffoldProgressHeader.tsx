import { useId, useState } from 'react';
import type { ScaffoldSectionProgress } from '../../services/api';
import {
  getAllSectionsByGroup,
  getSectionConfig,
  type SectionConfig,
  type SectionGroup
} from '../../utils/scaffoldUi';

/**
 * Section header + collapsible CARE progress.
 *
 * Deliberately NOT a persistent sidebar: the workspace only has room for three
 * panels (record / work / own summary), so the full section list is something
 * the learner opens when they need it and closes again.
 */

const GROUP_LABELS: Record<SectionGroup, string> = {
  record_facts: '기록에서 구성',
  clinical_process: '임상 과정',
  additional_authoring: '추가 작성'
};

type SectionState = {
  mark: string;
  markLabel: string;
  stateLabel: string;
  completed: boolean;
};

/**
 * Derived from the existing sectionProgress flags only - no new field, no new
 * backend state.
 */
export function deriveSectionState(progress?: ScaffoldSectionProgress): SectionState {
  const completed = Boolean(
    progress?.recordReviewCompleted &&
      progress?.missingInfoReviewCompleted &&
      progress?.draftRevealed &&
      progress?.draftReviewCompleted
  );

  if (completed) {
    return { mark: '✓', markLabel: '완료', stateLabel: '완료', completed: true };
  }

  if (progress?.draftRevealed) {
    return { mark: '●', markLabel: '진행 중', stateLabel: 'AI 검토 중', completed: false };
  }

  if (progress?.recordReviewCompleted || progress?.missingInfoReviewCompleted) {
    return { mark: '●', markLabel: '진행 중', stateLabel: '내 판단 중', completed: false };
  }

  return { mark: '○', markLabel: '시작 전', stateLabel: '시작 전', completed: false };
}

type ScaffoldProgressHeaderProps = {
  currentSectionId: string;
  availableSectionIds: string[];
  progressItems: ScaffoldSectionProgress[];
  onNavigate: (sectionId: string) => void;
};

export default function ScaffoldProgressHeader({
  currentSectionId,
  availableSectionIds,
  progressItems,
  onNavigate
}: ScaffoldProgressHeaderProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const progressById = new Map(progressItems.map((item) => [item.sectionId, item]));

  // Sections the case actually has; fall back to the full scaffold config when
  // the case has not reported its section list yet.
  const isAvailable = (section: SectionConfig) =>
    availableSectionIds.length === 0 || availableSectionIds.includes(section.sectionId);

  const grouped = getAllSectionsByGroup();
  const groups = (Object.keys(grouped) as SectionGroup[]).map((group) => ({
    group,
    sections: grouped[group].filter(isAvailable)
  }));

  const allSections = groups.flatMap((entry) => entry.sections);
  const completedCount = allSections.filter(
    (section) => deriveSectionState(progressById.get(section.sectionId)).completed
  ).length;

  const currentConfig = getSectionConfig(currentSectionId);
  const currentGroup = currentConfig ? GROUP_LABELS[currentConfig.group] : undefined;

  return (
    <header className="scaffold-workspace__header">
      <div className="scaffold-header__bar">
        <div className="scaffold-header__identity">
          <h1 className="scaffold-header__title">
            {currentConfig?.displayName || currentSectionId}
          </h1>
          {currentGroup ? <span className="scaffold-header__category">{currentGroup}</span> : null}
        </div>

        <div className="scaffold-header__meta">
          <span className="scaffold-header__count">
            {completedCount} / {allSections.length} 완료
          </span>
          <button
            type="button"
            className="scaffold-header__toggle"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls={panelId}
          >
            전체 진행상황
            <span aria-hidden="true">{open ? '▴' : '▾'}</span>
          </button>
        </div>
      </div>

      {open ? (
        <div className="scaffold-progress" id={panelId}>
          {groups.map(({ group, sections }) =>
            sections.length === 0 ? null : (
              <div key={group}>
                <h2 className="scaffold-progress__group-title">{GROUP_LABELS[group]}</h2>
                <ul className="scaffold-progress__list">
                  {sections.map((section) => {
                    const state = deriveSectionState(progressById.get(section.sectionId));
                    const isCurrent = section.sectionId === currentSectionId;

                    return (
                      <li key={section.sectionId}>
                        <button
                          type="button"
                          className="scaffold-progress__item"
                          aria-current={isCurrent ? 'page' : undefined}
                          onClick={() => {
                            setOpen(false);
                            if (!isCurrent) onNavigate(section.sectionId);
                          }}
                        >
                          {/* The mark is decorative; the state label carries the
                              same meaning in text so status is never colour-only. */}
                          <span className="scaffold-progress__mark" aria-hidden="true">
                            {state.mark}
                          </span>
                          <span className="scaffold-progress__name">{section.displayName}</span>
                          <span className="scaffold-progress__state">{state.stateLabel}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}
        </div>
      ) : null}
    </header>
  );
}
