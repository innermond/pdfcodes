import { m } from '../paraglide/messages'

export interface WizardStep {
  id: string
  label: string
}

export function WizardNav({
  steps,
  current,
  onSelect,
  isEnabled = () => true,
  lockedHint,
}: {
  steps: readonly WizardStep[]
  current: string
  onSelect: (id: string) => void
  // Whether a step can be navigated to. The current step is always selectable.
  isEnabled?: (step: WizardStep, index: number) => boolean
  // Tooltip shown on locked steps explaining why they're unavailable.
  lockedHint?: string
}) {
  return (
    <ol className="flex flex-wrap gap-inner">
      {steps.map((step, index) => {
        const active = step.id === current
        const enabled = active || isEnabled(step, index)
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => enabled && onSelect(step.id)}
              disabled={!enabled}
              title={!enabled ? lockedHint : undefined}
              className={`flex items-center gap-inner rounded-full px-3 py-1 text-label font-medium ${
                active
                  ? 'bg-blue-600 text-white'
                  : enabled
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-hint ${
                  active ? 'bg-white/20' : 'bg-gray-300 dark:bg-gray-700'
                }`}
              >
                {index + 1}
              </span>
              {step.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function WizardFooter({
  stepIndex,
  stepCount,
  onBack,
  onNext,
  nextDisabled = false,
}: {
  stepIndex: number
  stepCount: number
  onBack: () => void
  onNext: () => void
  nextDisabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between border-t border-gray-200 pt-block dark:border-gray-700">
      <button
        type="button"
        onClick={onBack}
        disabled={stepIndex === 0}
        className="rounded-lg border border-gray-300 px-3 py-1 text-label font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {m.wizard_back()}
      </button>
      <span className="text-label text-gray-500 dark:text-gray-400">
        {m.wizard_step_of({ index: stepIndex + 1, count: stepCount })}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={stepIndex === stepCount - 1 || nextDisabled}
        className="rounded-lg border border-gray-300 px-3 py-1 text-label font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {m.wizard_next()}
      </button>
    </div>
  )
}
