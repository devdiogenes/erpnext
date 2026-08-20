frappe.provide("erpnext.accounts.bank_reconciliation");

erpnext.accounts.bank_reconciliation.DialogManager = class DialogManager {
	constructor(
		company,
		bank_account,
		bank_statement_from_date,
		bank_statement_to_date,
		filter_by_reference_date,
		from_reference_date,
		to_reference_date
	) {
		this.bank_account = bank_account;
		this.company = company;
		this.make_dialog();
		this.bank_statement_from_date = bank_statement_from_date;
		this.bank_statement_to_date = bank_statement_to_date;
		this.filter_by_reference_date = filter_by_reference_date;
		this.from_reference_date = from_reference_date;
		this.to_reference_date = to_reference_date;
	}
	show_dialog(bank_transaction_name, update_dt_cards) {
		this.bank_transaction_name = bank_transaction_name;
		this.update_dt_cards = update_dt_cards;
		frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: "Bank Transaction",
				filters: { name: this.bank_transaction_name },
				fieldname: [
					"date",
					"deposit",
					"withdrawal",
					"currency",
					"description",
					"name",
					"bank_account",
					"company",
					"reference_number",
					"party_type",
					"party",
					"unallocated_amount",
					"allocated_amount",
					"transaction_type",
				],
			},
			callback: (r) => {
				if (r.message) {
					this.bank_transaction = r.message;
					this.company = r.message.company;
					r.message.payment_entry = 1;
					r.message.journal_entry = 1;
					this.dialog.set_values(r.message);
					this.dialog.set_value("deductions", []);
					this.copy_data_to_voucher();
					this.dialog.show();
				}
			},
		});
	}

	copy_data_to_voucher() {
		let copied = {
			reference_number: this.bank_transaction.reference_number || this.bank_transaction.description,
			posting_date: this.bank_transaction.date,
			reference_date: this.bank_transaction.date,
			mode_of_payment: this.bank_transaction.transaction_type,
		};
		this.dialog.set_values(copied);
	}

	get_linked_vouchers(document_types) {
		frappe.call({
			method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_linked_payments",
			args: {
				bank_transaction_name: this.bank_transaction_name,
				document_types: document_types,
				from_date: this.bank_statement_from_date,
				to_date: this.bank_statement_to_date,
				filter_by_reference_date: this.filter_by_reference_date,
				from_reference_date: this.from_reference_date,
				to_reference_date: this.to_reference_date,
			},

			callback: (result) => {
				const data = result.message;

				if (data && data.length > 0) {
					const proposals_wrapper = this.dialog.fields_dict.payment_proposals.$wrapper;
					proposals_wrapper.show();
					this.dialog.fields_dict.no_matching_vouchers.$wrapper.hide();
					const rows = data.map((row) => {
						const reference_date = row["reference_date"] || row["posting_date"];
						const exact_match =
							reference_date === this.bank_transaction.date &&
							row["paid_amount"] === this.bank_transaction.unallocated_amount;
						return { exact_match, row };
					});
					rows.sort((a, b) => (b.exact_match ? 1 : 0) - (a.exact_match ? 1 : 0));
					this.data = rows.map((r) => this.format_row(r.row));
					this._voucher_exact_match = rows.map((r) => r.exact_match);
					this.get_dt_columns();
					this.get_datatable(proposals_wrapper);
				} else {
					const proposals_wrapper = this.dialog.fields_dict.payment_proposals.$wrapper;
					proposals_wrapper.hide();
					this.dialog.fields_dict.no_matching_vouchers.$wrapper.show();
				}
				this.dialog.show();
			},
		});
	}

	get_dt_columns() {
		this.columns = [
			{
				name: __("Document Type"),
				editable: false,
				width: 125,
			},
			{
				name: __("Document Name"),
				editable: false,
				width: 1,
				format: (value, row) => {
					return frappe.form.formatters.Link(value, { options: row[2].content });
				},
			},
			{
				name: __("Reference Date"),
				editable: false,
				width: 120,
				format: (value, row) => {
					const idx = cint(row[1].content) - 1;
					const formatted = frappe.form.formatters.Date(value);
					return this._voucher_exact_match?.[idx]
						? `<span style="color:var(--green-500)">${formatted}</span>`
						: formatted;
				},
			},
			{
				name: __("Remaining"),
				editable: false,
				width: 100,
				format: (value, row) => {
					const idx = cint(row[1].content) - 1;
					return this._voucher_exact_match?.[idx]
						? `<span style="color:var(--green-500)">${value}</span>`
						: value;
				},
			},
			{
				name: __("Reference Number"),
				editable: false,
				width: 200,
			},
			{
				name: __("Party"),
				editable: false,
				width: 100,
			},
		];
	}

	format_row(row) {
		return [
			row["doctype"],
			row["name"],
			row["reference_date"] || row["posting_date"],
			format_currency(row["paid_amount"], row["currency"]),
			row["reference_no"],
			row["party"],
		];
	}

	get_datatable(proposals_wrapper) {
		if (!this.datatable) {
			const datatable_options = {
				columns: this.columns,
				data: this.data,
				dynamicRowHeight: true,
				checkboxColumn: true,
				inlineFilters: true,
			};
			this.datatable = new frappe.DataTable(proposals_wrapper.get(0), datatable_options);
		} else {
			this.datatable.refresh(this.data, this.columns);
			this.datatable.rowmanager.checkMap = [];
		}
	}

	make_dialog() {
		const me = this;
		me.selected_payment = null;

		const fields = [
			{
				label: __("Action"),
				fieldname: "action",
				fieldtype: "Select",
				options: `Match Against Voucher\nCreate Voucher\nUpdate Bank Transaction`,
				default: "Match Against Voucher",
			},
			{
				fieldname: "column_break_4",
				fieldtype: "Column Break",
			},
			{
				label: __("Document Type"),
				fieldname: "document_type",
				fieldtype: "Select",
				options: `Payment Entry\nJournal Entry`,
				default: "Payment Entry",
				depends_on: "eval:doc.action=='Create Voucher'",
			},
			{
				fieldtype: "Section Break",
				fieldname: "section_break_1",
				label: __("Filters"),
				depends_on: "eval:doc.action=='Match Against Voucher'",
			},
		];

		frappe.call({
			method: "erpnext.accounts.doctype.bank_transaction.bank_transaction.get_doctypes_for_bank_reconciliation",
			callback: (r) => {
				$.each(r.message, (_i, entry) => {
					if (_i % 3 == 0) {
						fields.push({
							fieldtype: "Column Break",
						});
					}
					fields.push({
						fieldtype: "Check",
						label: entry,
						fieldname: frappe.scrub(entry),
						onchange: () => this.update_options(),
					});
				});

				fields.push(...this.get_voucher_fields());

				me.dialog = new frappe.ui.Dialog({
					title: __("Reconcile the Bank Transaction"),
					fields: fields,
					size: "extra-large",
					primary_action: (values) => this.reconciliation_dialog_primary_action(values),
				});

				me.dialog.wrapper.on(
					"input.deductions_diff change.deductions_diff",
					"[data-fieldname='deductions'] input, [data-fieldname='deductions'] select",
					() => {
						me._recalculate_unallocated();
						const gw = me.dialog.fields_dict.invoices_grid?.$wrapper;
						if (gw && me.invoices_datatable) {
							me._update_invoice_footer(gw);
						}
					}
				);
			},
		});
	}

	get_voucher_fields() {
		return [
			{
				fieldtype: "Check",
				label: "Show Only Exact Amount",
				fieldname: "exact_match",
				onchange: () => this.update_options(),
			},
			{
				fieldname: "column_break_5",
				fieldtype: "Column Break",
			},
			{
				fieldtype: "Check",
				label: "Bank Transaction",
				fieldname: "bank_transaction",
				onchange: () => this.update_options(),
			},
			{
				fieldtype: "Section Break",
				fieldname: "section_break_1",
				label: __("Select Vouchers to Match"),
				depends_on: "eval:doc.action=='Match Against Voucher'",
			},
			{
				fieldtype: "HTML",
				fieldname: "payment_proposals",
			},
			{
				fieldtype: "HTML",
				fieldname: "no_matching_vouchers",
				options: __('<div class="text-muted text-center">{0}</div>', [
					__("No Matching Vouchers Found"),
				]),
			},
			{
				fieldtype: "Section Break",
				fieldname: "details",
				label: "Details",
				depends_on: "eval:doc.action!='Match Against Voucher'",
			},
			{
				fieldname: "reference_number",
				fieldtype: "Data",
				label: "Reference Number",
				mandatory_depends_on: "eval:doc.action=='Create Voucher'",
			},
			{
				default: "Today",
				fieldname: "posting_date",
				fieldtype: "Date",
				label: "Posting Date",
				reqd: 1,
				depends_on: "eval:doc.action=='Create Voucher'",
			},
			{
				fieldname: "reference_date",
				fieldtype: "Date",
				label: "Cheque/Reference Date",
				mandatory_depends_on: "eval:doc.action=='Create Voucher'",
				depends_on: "eval:doc.action=='Create Voucher'",
				reqd: 1,
			},
			{
				fieldname: "mode_of_payment",
				fieldtype: "Link",
				label: "Mode of Payment",
				options: "Mode of Payment",
				depends_on: "eval:doc.action=='Create Voucher'",
			},
			{
				fieldname: "edit_in_full_page",
				fieldtype: "Button",
				label: "Edit in Full Page",
				click: () => {
					this.edit_in_full_page();
				},
				depends_on: "eval:doc.action=='Create Voucher'",
			},
			{
				fieldname: "column_break_7",
				fieldtype: "Column Break",
			},
			{
				default: "Bank Entry",
				fieldname: "journal_entry_type",
				fieldtype: "Select",
				label: "Journal Entry Type",
				options:
					"Journal Entry\nInter Company Journal Entry\nBank Entry\nCash Entry\nCredit Card Entry\nDebit Note\nCredit Note\nContra Entry\nExcise Entry\nWrite Off Entry\nOpening Entry\nDepreciation Entry\nExchange Rate Revaluation\nDeferred Revenue\nDeferred Expense",
				depends_on: "eval:doc.action=='Create Voucher' &&  doc.document_type=='Journal Entry'",
				mandatory_depends_on:
					"eval:doc.action=='Create Voucher' &&  doc.document_type=='Journal Entry'",
			},
			{
				fieldname: "second_account",
				fieldtype: "Link",
				label: "Account",
				options: "Account",
				depends_on: "eval:doc.action=='Create Voucher' &&  doc.document_type=='Journal Entry'",
				mandatory_depends_on:
					"eval:doc.action=='Create Voucher' &&  doc.document_type=='Journal Entry'",
				get_query: () => {
					return {
						filters: {
							is_group: 0,
							company: this.company,
						},
					};
				},
			},
			{
				fieldname: "party_type",
				fieldtype: "Link",
				label: "Party Type",
				options: "DocType",
				mandatory_depends_on:
					"eval:doc.action=='Create Voucher' &&  doc.document_type=='Payment Entry'",
				get_query: function () {
					return {
						filters: {
							name: ["in", Object.keys(frappe.boot.party_account_types)],
						},
					};
				},
				onchange: () => {
					this.dialog.set_value("party", "");
					this.load_invoices();
				},
			},
			{
				fieldname: "party",
				fieldtype: "Dynamic Link",
				label: "Party",
				options: "party_type",
				mandatory_depends_on:
					"eval:doc.action=='Create Voucher' && doc.document_type=='Payment Entry'",
				onchange: () => this.load_invoices(),
				default: 1,
			},
			{
				fieldname: "bank_account",
				fieldtype: "Link",
				label: "Company Bank Account",
				options: "Bank Account",
				depends_on: "eval:doc.party",
				get_query: function () {
					return {
						filters: {
							is_company_account: 1,
							company: this.company,
						},
					};
				},
			},
			{
				fieldname: "project",
				fieldtype: "Link",
				label: "Project",
				options: "Project",
				depends_on: "eval:doc.action=='Create Voucher' && doc.document_type=='Payment Entry'",
			},
			{
				fieldname: "cost_center",
				fieldtype: "Link",
				label: "Cost Center",
				options: "Cost Center",
				depends_on: "eval:doc.action=='Create Voucher' && doc.document_type=='Payment Entry'",
				get_query: () => {
					return {
						filters: {
							is_group: 0,
							company: this.company,
						},
					};
				},
			},
			{
				fieldtype: "Section Break",
				fieldname: "select_invoices_section",
				label: __("Select Invoices"),
				depends_on:
					"eval:doc.action=='Create Voucher' && doc.document_type=='Payment Entry' && (doc.party_type=='Customer' || doc.party_type=='Supplier') && doc.party",
			},
			{
				fieldtype: "Check",
				fieldname: "based_on_payment_terms",
				label: __("Based On Payment Terms"),
				onchange: () => this.load_invoices(),
			},
			{
				fieldtype: "HTML",
				fieldname: "invoices_grid",
			},
			{
				fieldtype: "Section Break",
				fieldname: "deductions_section",
				label: __("Outras Taxas / Deduções"),
				depends_on: "eval:doc.action=='Create Voucher' && doc.document_type=='Payment Entry'",
				collapsible: 1,
				collapsed: 1,
			},
			{
				fieldtype: "Table",
				fieldname: "deductions",
				label: __("Deductions"),
				fields: [
					{
						fieldname: "account",
						fieldtype: "Link",
						label: __("Account"),
						options: "Account",
						in_list_view: 1,
						reqd: 1,
						get_query: () => ({
							filters: {
								is_group: 0,
								company: this.company,
							},
						}),
					},
					{
						fieldname: "cost_center",
						fieldtype: "Link",
						label: __("Cost Center"),
						options: "Cost Center",
						in_list_view: 1,
						reqd: 1,
						get_query: () => ({
							filters: {
								is_group: 0,
								company: this.company,
							},
						}),
					},
					{
						fieldname: "amount",
						fieldtype: "Currency",
						label: __("Amount"),
						in_list_view: 1,
						reqd: 1,
					},
				],
			},
			{
				fieldtype: "Section Break",
				fieldname: "details_section",
				label: "Transaction Details",
			},
			{
				fieldname: "date",
				fieldtype: "Date",
				label: "Date",
				read_only: 1,
			},
			{
				fieldname: "deposit",
				fieldtype: "Currency",
				label: "Deposit",
				options: "account_currency",
				read_only: 1,
			},
			{
				fieldname: "withdrawal",
				fieldtype: "Currency",
				label: "Withdrawal",
				options: "account_currency",
				read_only: 1,
			},
			{
				fieldname: "column_break_17",
				fieldtype: "Column Break",
				read_only: 1,
			},
			{
				fieldname: "description",
				fieldtype: "Small Text",
				label: "Description",
				read_only: 1,
			},
			{
				fieldname: "allocated_amount",
				fieldtype: "Currency",
				label: "Allocated Amount",
				options: "account_currency",
				read_only: 1,
			},
			{
				fieldname: "unallocated_amount",
				fieldtype: "Currency",
				label: "Unallocated Amount",
				options: "account_currency",
				read_only: 1,
			},
			{
				fieldname: "account_currency",
				fieldtype: "Link",
				label: "Currency",
				options: "Currency",
				read_only: 1,
				hidden: 1,
			},
		];
	}

	get_selected_attributes() {
		let selected_attributes = [];
		this.dialog.$wrapper.find(".checkbox input").each((i, col) => {
			if ($(col).is(":checked")) {
				selected_attributes.push($(col).attr("data-fieldname"));
			}
		});

		return selected_attributes;
	}

	update_options() {
		let selected_attributes = this.get_selected_attributes();
		this.get_linked_vouchers(selected_attributes);
	}

	reconciliation_dialog_primary_action(values) {
		if (values.action == "Match Against Voucher") this.match(values);
		if (values.action == "Create Voucher" && values.document_type == "Payment Entry")
			this.add_payment_entry(values);
		if (values.action == "Create Voucher" && values.document_type == "Journal Entry")
			this.add_journal_entry(values);
		else if (values.action == "Update Bank Transaction") this.update_transaction(values);
	}

	match() {
		var selected_map = this.datatable.rowmanager.checkMap;
		let rows = [];
		selected_map.forEach((val, index) => {
			if (val == 1) rows.push(this.datatable.datamanager.rows[index]);
		});
		let vouchers = [];
		rows.forEach((x) => {
			vouchers.push({
				payment_doctype: x[2].content,
				payment_name: x[3].content,
				amount: x[5].content,
			});
		});
		frappe.call({
			method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.reconcile_vouchers",
			args: {
				bank_transaction_name: this.bank_transaction.name,
				vouchers: vouchers,
			},
			callback: (response) => {
				const alert_string = __("Bank Transaction {0} Matched", [this.bank_transaction.name]);
				frappe.show_alert(alert_string);
				this.update_dt_cards(response.message);
				this.dialog.hide();
			},
		});
	}

	add_payment_entry(values) {
		frappe.call({
			method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.create_payment_entry_bts",
			args: {
				bank_transaction_name: this.bank_transaction.name,
				reference_number: values.reference_number,
				reference_date: values.reference_date,
				party_type: values.party_type,
				party: values.party,
				posting_date: values.posting_date,
				mode_of_payment: values.mode_of_payment,
				project: values.project,
				cost_center: values.cost_center,
				company_bank_account: values?.bank_account || this?.bank_account,
				invoices: this.get_selected_invoices(),
				deductions: values.deductions,
			},
			callback: (response) => {
				const alert_string = __("Bank Transaction {0} added as Payment Entry", [
					this.bank_transaction.name,
				]);
				frappe.show_alert(alert_string);
				this.update_dt_cards(response.message);
				this.dialog.hide();
			},
		});
	}

	add_journal_entry(values) {
		frappe.call({
			method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.create_journal_entry_bts",
			args: {
				bank_transaction_name: this.bank_transaction.name,
				reference_number: values.reference_number,
				reference_date: values.reference_date,
				party_type: values.party_type,
				party: values.party,
				posting_date: values.posting_date,
				mode_of_payment: values.mode_of_payment,
				entry_type: values.journal_entry_type,
				second_account: values.second_account,
			},
			callback: (response) => {
				const alert_string = __("Bank Transaction {0} added as Journal Entry", [
					this.bank_transaction.name,
				]);
				frappe.show_alert(alert_string);
				this.update_dt_cards(response.message);
				this.dialog.hide();
			},
		});
	}

	update_transaction(values) {
		frappe.call({
			method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.update_bank_transaction",
			args: {
				bank_transaction_name: this.bank_transaction.name,
				reference_number: values.reference_number,
				party_type: values.party_type,
				party: values.party,
			},
			callback: (response) => {
				const alert_string = __("Bank Transaction {0} updated", [this.bank_transaction.name]);
				frappe.show_alert(alert_string);
				this.update_dt_cards(response.message);
				this.dialog.hide();
			},
		});
	}

	load_invoices() {
		const values = this.dialog.get_values(true);
		const grid_wrapper = this.dialog.fields_dict.invoices_grid.$wrapper;

		if (
			!values.party_type ||
			!values.party ||
			(values.party_type !== "Customer" && values.party_type !== "Supplier")
		) {
			grid_wrapper.html("");
			return;
		}

		const unallocated_amount = this.bank_transaction ? this.bank_transaction.unallocated_amount || 0 : 0;
		frappe.call({
			method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_outstanding_invoices_for_reconciliation",
			args: {
				party_type: values.party_type,
				party: values.party,
				company: this.company,
				based_on_payment_terms: cint(this.dialog.get_value("based_on_payment_terms")),
				deposit: flt(this.bank_transaction.deposit),
				withdrawal: flt(this.bank_transaction.withdrawal),
				date: this.bank_transaction.date,
			},
			callback: (r) => {
				if (!r.message) return;
				const { invoices, invoice_doctype } = r.message;
				this.render_invoices_grid(invoices, invoice_doctype, values.party, unallocated_amount);
			},
		});
	}

	render_invoices_grid(invoices, invoice_doctype, party, unallocated_amount) {
		const grid_wrapper = this.dialog.fields_dict.invoices_grid.$wrapper;
		const currency = invoices.length > 0 ? invoices[0].currency : frappe.boot.sysdefaults.currency;

		this._invoices_data = invoices;
		this._invoice_currency = currency;
		this._base_unallocated_amount = unallocated_amount;
		this._unallocated_amount = unallocated_amount;
		this._invoices_allocations = {};
		this._invoices_checked = {};

		if (this.invoices_datatable) {
			$(`.${this.invoices_datatable.style.scopeClass}`).off(".invoices_dt");
			this.invoices_datatable = null;
		}

		if (!invoices.length) {
			grid_wrapper.html(`
				<div class="text-muted text-center" style="padding: 12px 0;">
					${__("No outstanding invoices found for {0}", [party])}
				</div>
			`);
			return;
		}

		const data = invoices.map((inv, idx) => [
			__(inv.voucher_type || invoice_doctype),
			inv.name,
			inv.bill_no || "-",
			frappe.datetime.str_to_user(inv.due_date) || "-",
			format_currency(inv.grand_total, inv.currency),
			format_currency(inv.outstanding_amount, inv.currency),
			idx,
		]);

		grid_wrapper.html('<div class="invoices-dt-container"></div>');
		grid_wrapper.append(`
			<div class="invoice-footer-summary"
				style="display:flex; justify-content:flex-end; gap:16px; align-items:center;
					padding: 8px 4px; border-top: 1px solid var(--border-color); margin-top: 2px;">
				<span>
					<span class="text-muted small">${__("Allocated")}: </span>
					<strong class="invoice-footer-allocated small">${format_currency(0, currency)}</strong>
				</span>
				<span>
					<span class="text-muted small">${__("Unallocated")}: </span>
					<strong class="invoice-footer-unallocated small" style="color: var(--blue-700);">
						${format_currency(unallocated_amount, currency)}
					</strong>
				</span>
			</div>
		`);

		this.invoices_datatable = new frappe.DataTable(grid_wrapper.find(".invoices-dt-container").get(0), {
			columns: this._get_invoice_dt_columns(),
			data: data,
			dynamicRowHeight: true,
			checkboxColumn: true,
			inlineFilters: true,
		});

		this._set_invoice_dt_listeners(grid_wrapper);
	}

	_get_invoice_dt_columns() {
		return [
			{
				name: "document_type",
				id: "document_type",
				content: `${__("Document Type")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				align: "left",
				width: 125,
			},
			{
				name: "document_name",
				id: "document_name",
				content: `${__("Document Name")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				align: "left",
				width: 180,
				format: (value, row) => {
					// row[2] = first data column (Document Type), offset +2 for Sr.No and Checkbox prepended by DataTable internally
					return frappe.form.formatters.Link(value, { options: row[2].content });
				},
			},
			{
				name: "invoice_no",
				id: "invoice_no",
				content: `${__("Invoice No")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				align: "left",
				width: 120,
			},
			{
				name: "due_date",
				id: "due_date",
				content: `${__("Due Date")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				align: "left",
				width: 120,
				format: (value, row) => {
					// row[8] = data[6] = idx (offset +2: Sr.No + Checkbox)
					const priority = this._invoices_data?.[row[8].content]?.priority;
					return priority === 0 || priority === 2
						? `<span style="color:var(--green-500)">${value}</span>`
						: value;
				},
			},
			{
				name: "grand_total",
				id: "grand_total",
				content: `${__("Grand Total")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				align: "right",
				width: 120,
			},
			{
				name: "outstanding_amount",
				id: "outstanding_amount",
				content: `${__("Outstanding")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				align: "right",
				width: 120,
				format: (value, row) => {
					// row[8] = data[6] = idx (offset +2: Sr.No + Checkbox)
					const priority = this._invoices_data?.[row[8].content]?.priority;
					return priority === 0 || priority === 1
						? `<span style="color:var(--green-500)">${value}</span>`
						: value;
				},
			},
			{
				name: "allocated_amount",
				id: "allocated_amount",
				content: `${__("Allocated")}`,
				editable: false,
				focusable: false,
				dropdown: false,
				sortable: false,
				align: "right",
				width: 120,
				format: (value) => {
					const idx = value;
					const alloc = this._invoices_allocations[idx] || 0;
					const checked = this._invoices_checked[idx] || false;
					return `<input type="number" class="allocated-amount form-control form-control-sm"
						data-index="${idx}" value="${alloc > 0 ? flt(alloc, 2) : 0}"
						min="0" style="text-align:right;" ${!checked ? "disabled" : ""}>`;
				},
			},
		];
	}

	_set_invoice_dt_listeners(grid_wrapper) {
		const scope = `.${this.invoices_datatable.style.scopeClass}`;

		$(scope).on("click.invoices_dt", "input[type='checkbox']", () => {
			setTimeout(() => this._sync_invoice_check_state(grid_wrapper), 0);
		});

		$(scope).on("input.invoices_dt", ".allocated-amount", () => {
			this._update_invoice_footer(grid_wrapper);
		});

		$(scope).on("blur.invoices_dt", ".allocated-amount", (e) => {
			const $input = $(e.target);
			const idx = parseInt($input.data("index"));
			const val = Math.max(parseFloat($input.val()) || 0, 0);
			$input.val(flt(val, 2));
			if (idx >= 0) this._invoices_allocations[idx] = val;
			this._update_invoice_footer(grid_wrapper);
		});
	}

	_sync_invoice_check_state(grid_wrapper) {
		if (!this.invoices_datatable) return;
		const checkMap = this.invoices_datatable.rowmanager.checkMap;
		checkMap.forEach((val, index) => {
			const checked = val == 1;
			const was_checked = this._invoices_checked[index] || false;

			if (checked && !was_checked) {
				const alloc = this._auto_alloc_dt(index, grid_wrapper);
				this._invoices_allocations[index] = alloc;
				this._invoices_checked[index] = true;
				grid_wrapper
					.find(`.allocated-amount[data-index="${index}"]`)
					.val(alloc > 0 ? flt(alloc, 2) : 0)
					.prop("disabled", false);
			} else if (!checked && was_checked) {
				this._invoices_allocations[index] = 0;
				this._invoices_checked[index] = false;
				grid_wrapper.find(`.allocated-amount[data-index="${index}"]`).val(0).prop("disabled", true);
			}
		});
		this._update_invoice_footer(grid_wrapper);
	}

	_auto_alloc_dt(idx, grid_wrapper) {
		const outstanding = this._invoices_data[idx]?.outstanding_amount || 0;
		const checkMap = this.invoices_datatable.rowmanager.checkMap;
		let already_allocated = 0;
		checkMap.forEach((val, other_idx) => {
			if (val == 1 && other_idx !== idx) {
				const $inp = grid_wrapper.find(`.allocated-amount[data-index="${other_idx}"]`);
				already_allocated += $inp.length
					? parseFloat($inp.val()) || 0
					: this._invoices_allocations[other_idx] || 0;
			}
		});
		const remaining = (this._unallocated_amount || 0) - already_allocated;
		return Math.min(outstanding, Math.max(0, remaining));
	}

	_update_invoice_footer(grid_wrapper) {
		if (!this.invoices_datatable) return;
		const checkMap = this.invoices_datatable.rowmanager.checkMap;
		let total_allocated = 0;
		checkMap.forEach((val, index) => {
			if (val == 1) {
				const $input = grid_wrapper.find(`.allocated-amount[data-index="${index}"]`);
				total_allocated += $input.length
					? parseFloat($input.val()) || 0
					: this._invoices_allocations[index] || 0;
			}
		});
		const unallocated = (this._unallocated_amount || 0) - total_allocated;
		const currency = this._invoice_currency;
		grid_wrapper.find(".invoice-footer-allocated").text(format_currency(total_allocated, currency));
		const $unalloc = grid_wrapper.find(".invoice-footer-unallocated");
		const color =
			unallocated < 0 ? "var(--red-500)" : unallocated === 0 ? "var(--green-500)" : "var(--blue-700)";
		$unalloc.text(format_currency(unallocated, currency)).css("color", color);
	}

	_get_total_deductions() {
		const rows = this.dialog.get_value("deductions") || [];
		return rows.reduce((sum, row) => sum + flt(row.amount || 0), 0);
	}

	_recalculate_unallocated() {
		const bt = this.bank_transaction;
		if (!bt) return;
		const base = this._base_unallocated_amount || 0;
		const total_deductions = this._get_total_deductions();
		const is_receive = flt(bt.deposit || 0) > 0;
		this._unallocated_amount = Math.max(
			0,
			is_receive ? base + total_deductions : base - total_deductions
		);
	}

	get_selected_invoices() {
		if (!this._invoices_data || !this.invoices_datatable) return [];
		const checkMap = this.invoices_datatable.rowmanager.checkMap;
		const grid_wrapper = this.dialog.fields_dict.invoices_grid.$wrapper;
		return checkMap.reduce((selected, val, index) => {
			if (val == 1 && this._invoices_data[index]) {
				const $input = grid_wrapper.find(`.allocated-amount[data-index="${index}"]`);
				const allocated_amount = $input.length
					? parseFloat($input.val()) || 0
					: this._invoices_allocations[index] || 0;
				selected.push({ ...this._invoices_data[index], allocated_amount });
			}
			return selected;
		}, []);
	}

	edit_in_full_page() {
		const values = this.dialog.get_values(true);
		if (values.document_type == "Payment Entry") {
			frappe.call({
				method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.create_payment_entry_bts",
				args: {
					bank_transaction_name: this.bank_transaction.name,
					reference_number: values.reference_number,
					reference_date: values.reference_date,
					party_type: values.party_type,
					party: values.party,
					posting_date: values.posting_date,
					mode_of_payment: values.mode_of_payment,
					project: values.project,
					cost_center: values.cost_center,
					invoices: this.get_selected_invoices(),
					deductions: values.deductions,
					allow_edit: true,
					company_bank_account: values?.bank_account || this?.bank_account,
				},
				callback: (r) => {
					const doc = frappe.model.sync(r.message);
					frappe.set_route("Form", doc[0].doctype, doc[0].name);
				},
			});
		} else {
			frappe.call({
				method: "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.create_journal_entry_bts",
				args: {
					bank_transaction_name: this.bank_transaction.name,
					reference_number: values.reference_number,
					reference_date: values.reference_date,
					party_type: values.party_type,
					party: values.party,
					posting_date: values.posting_date,
					mode_of_payment: values.mode_of_payment,
					entry_type: values.journal_entry_type,
					second_account: values.second_account,
					allow_edit: true,
				},
				callback: (r) => {
					var doc = frappe.model.sync(r.message);
					frappe.set_route("Form", doc[0].doctype, doc[0].name);
				},
			});
		}
	}
};
