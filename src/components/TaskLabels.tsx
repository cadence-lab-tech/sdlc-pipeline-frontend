// Метки задачи одним видом на всех экранах: плитка доски и шапка карточки
// рисуют их отсюда, иначе два вида разъедутся при следующей правке.
// Меток нет — нет и контейнера: пустой блок оставил бы в раскладке отступ.
export function TaskLabels({labels}: {labels: string[]}) {
  if (labels.length === 0) return null;

  return (
    <div className="text-muted-foreground flex flex-wrap gap-1 text-xs">
      {labels.map((l) => (
        <span key={l}>#{l}</span>
      ))}
    </div>
  );
}
