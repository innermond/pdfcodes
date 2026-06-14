export interface WizardStep {
  id: string
  label: string
}

export function WizardNav({
  steps,
  current,
  onSelect,
}: {
  steps: readonly WizardStep[]
  current: string
  onSelect: (id: string) => void
}) {
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((step, index) => {
        const active = step.id === current
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
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
}: {
  stepIndex: number
  stepCount: number
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
      <button
        type="button"
        onClick={onBack}
        disabled={stepIndex === 0}
        className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        ← Înapoi
      </button>
      <span className="text-sm text-gray-500 dark:text-gray-400">
        Pasul {stepIndex + 1} din {stepCount}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={stepIndex === stepCount - 1}
        className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Continuă →
      </button>
    </div>
  )
}
