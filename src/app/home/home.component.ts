import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import { catchError, delay, forkJoin, of } from 'rxjs';
import { HeaderComponent } from '../components/header/header.component';

interface ConsultaCuit {
  cuit: string;
  nombre: string;
  dataDeuda: any;
  dataCheques: any;
  analisis: {
    totalDeuda: number;
    maloDeuda: number;
    tieneChequesSinFondoRecientes: boolean;
    motivoRechazo: string | null;
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

    // Consultamos ambas APIs en paralelo
    forkJoin({
      deuda: this.bcraSvc.getDeudas(cuit).pipe(catchError(() => of(null))),
      cheques: this.bcraSvc.getChequesRechazados(cuit).pipe(catchError(() => of(null)))
    })
      .pipe(delay(500))
      .subscribe({
        next: (res) => {
          if (res.deuda && res.deuda.results) {
            const analisis = this.procesarRiesgoCompleto(res.deuda, res.cheques);
            const nombrePersona = res.deuda.results.denominacion || 'Nombre no disponible';

            this.consultasAcumuladas.update(prev => [...prev, {
              cuit: cuit,
              nombre: nombrePersona,
              dataDeuda: res.deuda,
              dataCheques: res.cheques,
              analisis: analisis
            }]);

            this.cuitBusqueda = '';
          } else {
            this.errorConsulta.set(`El CUIT ${cuit} no tiene registros en Deudas.`);
          }
          this.cargando.set(false);
        }
      });
  }

  private procesarRiesgoCompleto(deuda: any, cheques: any) {
    // 1. Validar Cheques Sin Fondo en los últimos 6 meses
    let tieneChequesSinFondoRecientes = false;
    const seisMesesAtras = new Date();
    seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);

    if (cheques?.results?.causales) {
      const sinFondos = cheques.results.causales.find((c: any) => c.causal === "SIN FONDOS");

      if (sinFondos) {
        sinFondos.entidades.forEach((ent: any) => {
          ent.detalle.forEach((det: any) => {
            const fechaRechazo = new Date(det.fechaRechazo);
            if (fechaRechazo >= seisMesesAtras) {
              tieneChequesSinFondoRecientes = true;
            }
          });
        });
      }
    }

    // 2. Validar Deuda Histórica
    const entidades = deuda.results.periodos[0]?.entidades || [];
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0);
    const deudaMala = entidades
      .filter((e: any) => e.situacion > 1)
      .reduce((acc: number, e: any) => acc + (e.monto || 0), 0);

    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;

    // Lógica de rechazo combinada
    let rechazado = false;
    let motivo = null;

    if (tieneChequesSinFondoRecientes) {
      rechazado = true;
      motivo = "Cheques sin fondo en los últimos 6 meses";
    } else if (porcentajeMalo > 10) {
      rechazado = true;
      motivo = "Exceso de deuda en situación irregular (>10%)";
    }

    return {
      totalDeuda: totalDeuda,
      maloDeuda: deudaMala,
      tieneChequesSinFondoRecientes,
      motivoRechazo: motivo,
      rechazado: rechazado
    };
  }

  eliminarConsulta(cuit: string) {
    this.consultasAcumuladas.update(prev => prev.filter(c => c.cuit !== cuit));
    if (this.consultasAcumuladas().length === 0) this.mostrarDetalles.set(false);
  }

  limpiarTodo() {
    this.consultasAcumuladas.set([]);
    this.mostrarDetalles.set(false);
    this.errorConsulta.set(null);
    this.cuitBusqueda = '';
  }

  toggleMostrar() { this.mostrarDetalles.set(true); }

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