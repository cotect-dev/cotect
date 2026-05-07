import { useEffect } from 'react'
import { useUsageStore } from '@/store/usage'
import DateRangePicker from '@/components/Analytics/DateRangePicker'
import HeadlineStrip from '@/components/Analytics/HeadlineStrip'
import SpendChart from '@/components/Analytics/SpendChart'
import LatencyChart from '@/components/Analytics/LatencyChart'
import BreakdownTable from '@/components/Analytics/BreakdownTable'
import TaskList from '@/components/Analytics/TaskList'

export default function Analytics() {
  const start = useUsageStore((s) => s.start)
  useEffect(() => start(), [start])

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-base font-semibold">Analytics</h1>
          <DateRangePicker />
        </div>
        <div className="flex flex-col gap-8">
          <HeadlineStrip />
          <SpendChart />
          <LatencyChart />
          <BreakdownTable />
          <TaskList />
        </div>
      </div>
    </div>
  )
}
