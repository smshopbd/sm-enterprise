import { TestBed } from '@angular/core/testing';
import { PartyLedger } from './party-ledger';
import { DataService, Party } from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { StorageService } from '../../services/storage';
import { NotificationService } from '../../services/notification';
import { CloudService } from '../../services/cloud';

const party: Party = {
  id: 1,
  name: 'Test Party',
  companyName: '',
  type: 'Customer',
  total: 0,
  paid: 0,
  due: 500,
  status: 'Enabled',
  inHand: '',
  zone: '',
  email: '',
  phone: '01700000000',
  createdAt: '2026-11-11',
  address: ''
};

function setup() {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DataService,
        useValue: {
          hydrated: () => true,
          voucherSettings: () => ({ businessNamePart1: 'SM', businessNamePart2: 'Enterprise', address: '', mobile: '' })
        }
      },
      { provide: SessionService, useValue: { log: () => undefined } },
      { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en, t: (key: string) => key } }
    ]
  });
  const fixture = TestBed.createComponent(PartyLedger);
  fixture.componentRef.setInput('party', party);
  fixture.componentRef.setInput('paymentOnly', true);
  fixture.detectChanges();
  return fixture;
}

describe('PartyLedger payment-only mode', () => {
  it('shows the payment form without the party profile drawer', () => {
    const text = (setup().nativeElement.textContent as string);

    expect(text).toContain('ledger.recordPayment');
    expect(text).toContain('Test Party');
    expect(text).not.toContain('Party Profile');
  });

  it('closes the whole overlay when the payment form is dismissed', () => {
    const fixture = setup();
    let closed = false;
    fixture.componentInstance.close.subscribe(() => { closed = true; });

    const cancel = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('common.cancel'));
    expect(cancel).toBeTruthy();
    cancel!.click();

    expect(closed).toBe(true);
  });
});

function ledgerSetup(role: 'Admin' | 'Salesman') {
  TestBed.configureTestingModule({
    providers: [
      DataService,
      {
        provide: StorageService,
        useValue: { read: () => null, write: () => undefined, init: async () => undefined, onRemoteChange: () => () => undefined }
      },
      { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en, t: (key: string) => key, language: () => 'en' } },
      { provide: NotificationService, useValue: { show: () => undefined, success: () => undefined, error: () => undefined } },
      { provide: CloudService, useValue: { isEnabled: () => false } },
      { provide: SessionService, useValue: { log: () => undefined, currentUser: () => ({ role }) } }
    ]
  });
  const data = TestBed.inject(DataService);
  data.parties.set([{ ...party, salesTotal: 500, salesPaid: 0, salesDue: 500, salesAdvance: 0 }]);
  data.recordPayment({ partyId: 1, partyName: 'Test Party', partyType: 'Customer', amount: 100, discount: 0, mode: 'Cash', date: '2026-11-11', note: '' });
  data.hydrated.set(true);
  const fixture = TestBed.createComponent(PartyLedger);
  fixture.componentRef.setInput('party', data.parties()[0]);
  fixture.detectChanges();
  return { data, fixture };
}

describe('PartyLedger payment correction', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lets an Admin rewrite a receipt only after the PIN gate', () => {
    const { data, fixture } = ledgerSetup('Admin');
    const component = fixture.componentInstance;
    const payment = data.payments()[0];

    expect(fixture.nativeElement.querySelectorAll('button[title="Edit payment (admin PIN)"]').length).toBeGreaterThan(0);

    component.openEditPayment(payment);
    expect(component.showPayment()).toBe(true);
    expect(component.payAmount).toBe(100);

    component.payAmount = 250;
    component.savePayment();

    expect(component.showEditPin()).toBe(true);
    expect(data.payments()[0].amount).toBe(100);

    component.confirmEditPayment();

    expect(component.showEditPin()).toBe(false);
    expect(data.payments()[0].amount).toBe(250);
    expect(data.parties()[0].salesDue).toBe(250);
    expect(data.parties()[0].salesPaid).toBe(250);
  });

  it('hides the correction controls from non-admin users', () => {
    const { data, fixture } = ledgerSetup('Salesman');
    const component = fixture.componentInstance;

    expect(fixture.nativeElement.querySelectorAll('button[title="Edit payment (admin PIN)"]').length).toBe(0);

    component.openEditPayment(data.payments()[0]);
    expect(component.showPayment()).toBe(false);
  });
});
