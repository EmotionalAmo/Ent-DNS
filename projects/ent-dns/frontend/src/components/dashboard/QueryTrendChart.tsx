import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export interface QueryTrendData {
  time: string;
  queries: number;
  blocked: number;
  allowed: number;
}

interface QueryTrendChartProps {
  data: QueryTrendData[];
  isLoading?: boolean;
}

export function QueryTrendChart({ data, isLoading }: QueryTrendChartProps) {
  if (isLoading) {
    return (
      <div className="h-[300px] flex items-center justify-center bg-muted/20 rounded-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center bg-muted/20 rounded-lg">
        <p className="text-sm text-muted-foreground">暂无查询数据</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="stroke-muted" />
        <XAxis
          dataKey="time"
          stroke="currentColor"
          className="stroke-muted-foreground"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="currentColor"
          className="stroke-muted-foreground"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString()}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
          }}
          labelStyle={{ color: 'hsl(var(--foreground))' }}
        />
        <Legend
          wrapperStyle={{
            paddingTop: '1rem',
          }}
        />
        <Line
          type="monotone"
          dataKey="queries"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
          name="总查询"
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="blocked"
          stroke="hsl(var(--destructive))"
          strokeWidth={2}
          dot={false}
          name="拦截"
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="allowed"
          stroke="hsl(var(--success))"
          strokeWidth={2}
          dot={false}
          name="允许"
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
