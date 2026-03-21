import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import { catchError, delay, of } from 'rxjs';
import { HeaderComponent } from '../components/header/header.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private bcraSvc = inject(BcraService);

  cuitBusqueda = '';
  resultado = signal<any>(null);
  cargando = signal<boolean>(false);
  errorConsulta = signal<string | null>(null);

  // Resultado de la validación de riesgo
  estadoValidacion = signal<{
    total: number,
    malo: number,
    porcentajeMalo: number,
    rechazado: boolean
  } | null>(null);

  buscarDeuda() {
    if (!this.cuitBusqueda || this.cuitBusqueda.length < 11) return;

    this.cargando.set(true);
    this.resultado.set(null);
    this.estadoValidacion.set(null);
    this.errorConsulta.set(null);

    this.bcraSvc.getDeudas(this.cuitBusqueda)
      .pipe(
        delay(1000), // Delay para suavizar la carga y evitar bloqueos del BCRA
        catchError(error => {
          console.error('Error en la consulta', error);
          this.errorConsulta.set('No se pudo obtener respuesta del BCRA. Verifique la conexión.');
          return of(null);
        })
      )
      .subscribe({
        next: (data) => {
          if (data && data.results) {
            this.resultado.set(data);
            this.procesarRiesgo(data);
          } else if (!this.errorConsulta()) {
            this.errorConsulta.set('El CUIT ingresado no posee registros en la base de datos.');
          }
          this.cargando.set(false);
        }
      });
  }

  private procesarRiesgo(data: any) {
    if (!data.results?.periodos?.length) return;

    const entidades = data.results.periodos[0].entidades;
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0);
    const deudaMala = entidades
      .filter((e: any) => e.situacion > 1)
      .reduce((acc: number, e: any) => acc + (e.monto || 0), 0);

    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;
    const rechazado = porcentajeMalo > 10;

    this.estadoValidacion.set({
      total: totalDeuda,
      malo: deudaMala,
      porcentajeMalo: porcentajeMalo,
      rechazado: rechazado
    });
  }

  formatPeriodo(p: string) {
    return p ? `${p.substring(4)}/${p.substring(2, 4)}` : 'N/A';
  }

  getSituacionClass(s: number) {
    const base = "px-3 py-1 rounded-full text-[11px] font-bold ";
    if (s === 1) return base + "bg-green-50 text-green-700";
    if (s === 2) return base + "bg-yellow-50 text-yellow-700";
    return base + "bg-red-50 text-red-700";
  }
}