import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import { catchError, delay, of } from 'rxjs';
import { HeaderComponent } from '../components/header/header.component';

interface ConsultaCuit {
  cuit: string;
  nombre: string; // <-- Nuevo campo para la razón social
  data: any;
  analisis: {
    total: number;
    malo: number;
    porcentajeMalo: number;
    rechazado: boolean;
  } | null;
}

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
  cargando = signal<boolean>(false);
  errorConsulta = signal<string | null>(null);

  consultasAcumuladas = signal<ConsultaCuit[]>([]);
  mostrarDetalles = signal<boolean>(false);

  agregarConsulta() {
    const cuit = this.cuitBusqueda.trim();
    if (!cuit || cuit.length < 11) return;

    if (this.consultasAcumuladas().some(c => c.cuit === cuit)) {
      this.errorConsulta.set(`El CUIT ${cuit} ya está en la lista.`);
      return;
    }

    this.cargando.set(true);
    this.errorConsulta.set(null);

    this.bcraSvc.getDeudas(cuit)
      .pipe(
        delay(800),
        catchError(error => {
          this.errorConsulta.set(`Error con CUIT ${cuit}. Intente nuevamente.`);
          return of(null);
        })
      )
      .subscribe({
        next: (data) => {
          if (data && data.results) {
            const analisis = this.procesarRiesgo(data);

            // Extraemos la denominación (Nombre) de la respuesta del BCRA
            const nombrePersona = data.results.denominacion || 'Nombre no disponible';

            this.consultasAcumuladas.update(prev => [...prev, {
              cuit: cuit,
              nombre: nombrePersona, // Guardamos el nombre
              data: data,
              analisis: analisis
            }]);

            this.cuitBusqueda = '';
          } else {
            this.errorConsulta.set(`El CUIT ${cuit} no tiene registros.`);
          }
          this.cargando.set(false);
        }
      });
  }

  private procesarRiesgo(data: any) {
    if (!data.results?.periodos?.length) return null;

    const entidades = data.results.periodos[0].entidades || [];
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0);
    const deudaMala = entidades
      .filter((e: any) => e.situacion > 1)
      .reduce((acc: number, e: any) => acc + (e.monto || 0), 0);

    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;

    return {
      total: totalDeuda,
      malo: deudaMala,
      porcentajeMalo: porcentajeMalo,
      rechazado: porcentajeMalo > 10
    };
  }

  toggleMostrar() {
    this.mostrarDetalles.set(true);
  }

  formatPeriodo(p: string) {
    return p ? `${p.substring(4)}/${p.substring(2, 4)}` : 'N/A';
  }

  getSituacionClass(s: number) {
    const base = "px-3 py-1 rounded-full text-[11px] font-bold ";
    if (s === 1) return base + "bg-green-100 text-green-700";
    if (s === 2) return base + "bg-yellow-100 text-yellow-700";
    return base + "bg-red-100 text-red-700";
  }
}