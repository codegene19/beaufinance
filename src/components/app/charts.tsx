'use client';
import * as React from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ReferenceLine, LineChart,
} from 'recharts';

const C = { sage: '#4a6c4f', sageLight: '#84a383', gold: '#b8955a', ink: '#24272a', rose: '#a4453b', sky: '#2f5d73', grid: '#ebe4d6', muted: '#6f7275' };
export const SERIES = [C.sage, C.gold, C.sky, C.rose, C.sageLight, '#8a7a9b', C.ink];

const eur = (currency: string) => (v: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0, notation: Math.abs(v) >= 10000 ? 'compact' : 'standard' }).format(v);
const axis = { fontSize: 11, fill: C.muted } as const;

function Empty({ label = 'No data for this period yet' }: { label?: string }) {
  return <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted">{label}</div>;
}

function TipBox({ active, payload, label, currency, money = true }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-medium text-ink">{money ? eur(currency)(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data, currency = 'EUR', height = 280 }: { data: { period: string; netSales: number; grossProfit: number; contributionAfterAds: number; netProfit: number }[]; currency?: string; height?: number }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.sage} stopOpacity={0.25} />
            <stop offset="100%" stopColor={C.sage} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="period" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={eur(currency)} width={64} />
        <Tooltip content={<TipBox currency={currency} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <ReferenceLine y={0} stroke={C.muted} strokeDasharray="3 3" />
        <Area type="monotone" dataKey="netSales" name="Net sales" stroke={C.sage} fill="url(#gSales)" strokeWidth={2} />
        <Line type="monotone" dataKey="grossProfit" name="Gross profit" stroke={C.gold} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="contributionAfterAds" name="Profit after ads" stroke={C.sky} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="netProfit" name="Net operating profit" stroke={C.rose} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HBars({ data, dataKey, nameKey = 'name', currency = 'EUR', money = true, color = C.sage, height }: { data: any[]; dataKey: string; nameKey?: string; currency?: string; money?: boolean; color?: string; height?: number }) {
  if (!data.length) return <Empty />;
  const h = height ?? Math.max(160, data.length * 34 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={money ? eur(currency) : undefined} />
        <YAxis type="category" dataKey={nameKey} tick={{ ...axis, fill: C.ink }} tickLine={false} axisLine={false} width={150} />
        <Tooltip content={<TipBox currency={currency} money={money} />} cursor={{ fill: '#f3eee4' }} />
        <ReferenceLine x={0} stroke={C.muted} />
        <Bar dataKey={dataKey} name={dataKey === 'contribution' ? 'Contribution after ads' : dataKey === 'revenue' ? 'Net revenue' : dataKey} radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d[dataKey] < 0 ? C.rose : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, currency = 'EUR', height = 240 }: { data: { name: string; value: number }[]; currency?: string; height?: number }) {
  const d = data.filter((x) => x.value > 0);
  if (!d.length) return <Empty />;
  const total = d.reduce((a, x) => a + x.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="w-full sm:w-1/2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={d} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2} stroke="none">
              {d.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: any) => eur(currency)(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
        {d.map((x, i) => (
          <li key={x.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
              <span className="truncate text-ink-soft">{x.name}</span>
            </span>
            <span className="num text-muted">{((x.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CashBars({ data, currency = 'EUR', height = 260 }: { data: { period: string; cashIn: number; cashOut: number; net: number }[]; currency?: string; height?: number }) {
  if (!data.length) return <Empty label="No cash movements recorded in this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="period" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={eur(currency)} width={64} />
        <Tooltip content={<TipBox currency={currency} />} cursor={{ fill: '#f3eee4' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Bar dataKey="cashIn" name="Cash in" fill={C.sage} radius={[3, 3, 0, 0]} />
        <Bar dataKey="cashOut" name="Cash out" fill={C.gold} radius={[3, 3, 0, 0]} />
        <Line dataKey="net" name="Net" stroke={C.ink} strokeWidth={1.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GroupedBars({ data, keys, xKey, currency = 'EUR', height = 260, money = true }: { data: any[]; keys: { key: string; name: string; color?: string }[]; xKey: string; currency?: string; height?: number; money?: boolean }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 60 : 30} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={money ? eur(currency) : undefined} width={64} />
        <Tooltip content={<TipBox currency={currency} money={money} />} cursor={{ fill: '#f3eee4' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <ReferenceLine y={0} stroke={C.muted} />
        {keys.map((k, i) => (
          <Bar key={k.key} dataKey={k.key} name={k.name} fill={k.color ?? SERIES[i]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LinesChart({ data, keys, xKey, currency = 'EUR', height = 260, money = true, refY }: { data: any[]; keys: { key: string; name: string; color?: string; dashed?: boolean }[]; xKey: string; currency?: string; height?: number; money?: boolean; refY?: { y: number; label: string } }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={money ? eur(currency) : undefined} width={64} />
        <Tooltip content={<TipBox currency={currency} money={money} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {refY && <ReferenceLine y={refY.y} stroke={C.rose} strokeDasharray="4 3" label={{ value: refY.label, fontSize: 11, fill: C.rose, position: 'insideTopRight' }} />}
        {keys.map((k, i) => (
          <Line key={k.key} type="stepAfter" dataKey={k.key} name={k.name} stroke={k.color ?? SERIES[i]} strokeWidth={2} strokeDasharray={k.dashed ? '5 4' : undefined} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
