import {cn} from '@/lib/utils';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';

// Таблица с описанием колонок: страницы задают, что показывать, а не верстают
// строки заново каждый раз. Ширина в пикселях — для колонок, которые не должны
// разъезжаться (время, действия); остальные делят остаток.
export type Column<T> = {
  key: string;
  header: React.ReactNode;
  width?: number;
  align?: 'start' | 'end';
  renderCell?: (row: T) => React.ReactNode;
};

export function DataTable<T>({
  data,
  columns,
  idKey,
  onRowClick,
  empty,
}: {
  data: T[];
  columns: Column<T>[];
  // Ключ строки: имя поля или функция — составной ключ встречается там, где
  // строка сама по себе не имеет идентификатора (разрез метрик, например).
  idKey: keyof T | ((row: T) => string);
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  if (data.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead
                key={c.key}
                style={c.width ? {width: c.width} : undefined}
                className={cn(c.align === 'end' && 'text-right')}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow
              key={typeof idKey === 'function' ? idKey(row) : String(row[idKey])}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && 'cursor-pointer')}>
              {columns.map((c) => (
                <TableCell key={c.key} className={cn(c.align === 'end' && 'text-right')}>
                  {c.renderCell ? c.renderCell(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
