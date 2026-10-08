# tools/servidor/crear_segmentos_hilera_completa.py — Se ejecuta en el VPS de la PLATAFORMA (no en la app), v0.4.5.
# Uso: cd /srv/riachuelo/deploy && docker compose exec -T web python manage.py shell < crear_segmentos_hilera_completa.py
#
# Crea, SOLO en las hileras activas que no tienen segmentos ni marcadores, un segmento «hilera completa»
# (planta 1 a la última) con un marcador INICIO y uno FIN, sin coordenadas. Se puede repetir: no duplica nada.
from django.db import transaction
from campo.models import FieldRow, FieldSegment, Marker

creadas = 0
with transaction.atomic():
    for row in FieldRow.objects.filter(active=True).select_related("lot").order_by("lot_id", "number"):
        if row.segments.exists() or row.markers.exists():
            continue
        n = f"H{row.number:02d}"
        seg = FieldSegment.objects.create(id=f"{row.id}-S1", row=row, code=f"{n} completa",
                                          start_plant=1, end_plant=max(1, row.plant_count), is_pilot=False)
        Marker.objects.create(id=f"{row.id}-INI", row=row, segment=seg, code=f"{n} inicio", position="INICIO",
                              description="Inicio de la hilera (planta 1). Sin coordenadas.")
        Marker.objects.create(id=f"{row.id}-FIN", row=row, segment=seg, code=f"{n} fin", position="FIN",
                              description=f"Fin de la hilera (planta {row.plant_count}). Sin coordenadas.")
        creadas += 1
print(f"Hileras completadas: {creadas}")
print(f"Total: {FieldSegment.objects.count()} segmentos y {Marker.objects.count()} marcadores")
