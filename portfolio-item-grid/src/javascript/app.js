Ext.define("portfolio-item-grid", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    config: {
        defaultSettings: {
            showScopeSelector: true,
            selectorType: null,
            type: 'hierarchicalrequirement',
            columnNames: ['FormattedID','Name'],
            //order: this.order,
            //query: this.query,
            showControls: true
        }
    },

    disallowedAddNewTypes: ['user', 'userprofile', 'useriterationcapacity', 'testcaseresult', 'task', 'scmrepository', 'project', 'changeset', 'change', 'builddefinition', 'build', 'program'],
    orderedAllowedPageSizes: [10, 25, 50, 100, 200],

    launch: function() {
        Rally.technicalservices.WsapiToolbox.fetchPortfolioItemTypes().then({
            success: function(portfolioItemTypes){
                this.portfolioItemTypes = portfolioItemTypes;
                this.addComponents();
            },
            failure: function(msg){
                this.logger.log('failed to load Portfolio Item Types', msg);
                Rally.ui.notify.Notifier.showError({message: msg});
            },
            scope: this
        });
    },
    getHeader: function(){
        this.logger.log('getHeader');
        return this.headerContainer;
    },
    getBody: function(){
        return this.displayContainer;
    },
    getGridboard: function(){
        return this.gridboard;
    },
    getModelNames: function(){
        return this.getSetting('type');
    },

    addComponents: function(){
        this.logger.log('addComponents',this.portfolioItemTypes);

        this.removeAll();

        this.headerContainer = this.add({xtype:'container',itemId:'header-ct', layout: {type: 'hbox'}});
        this.displayContainer = this.add({xtype:'container',itemId:'body-ct', tpl: '<tpl>{message}</tpl>'});

        if ( this.getSetting('showScopeSelector') || this.getSetting('showScopeSelector') == "true" ) {
            this.getHeader().add({
                xtype: 'portfolioitemselector',
                context: this.getContext(),
                type: this.getSetting('selectorType'),
                stateId: this.getContext().getScopedStateId('app-selector'),
                width: '75%',
                listeners: {
                    change: this.updatePortfolioItem,
                    scope: this
                }
            });
        } else {
            this.subscribe(this, 'portfolioItemSelected', this.updatePortfolioItem, this);
            this.publish('requestPortfolioItem', this);
        }
    },
    updatePortfolioItem: function(portfolioItemRecord){
        this.logger.log('updatePortfolioItem', portfolioItemRecord);

        this.getBody().removeAll();

        this.portfolioItem = portfolioItemRecord;
        this.loadGridBoard();

    },
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        Ext.apply(this, settings);
        this.addComponents();
    },
    getSettingsFields: function() {
       return Rally.technicalservices.PortfolioItemGridSettings.getFields(this.getContext());
    },
    loadGridBoard: function(){
        this.logger.log('loadGridBoard', this.getModelNames())
        this.enableAddNew = this._shouldEnableAddNew();
        this.enableRanking = this._shouldEnableRanking();

        Rally.data.ModelFactory.getModels({
            context: this.getContext(),
            types: this.getModelNames(),
            requester: this
        }).then({
            success: function (models) {
                this.models = _.transform(models, function (result, value) {
                    result.push(value);
                }, []);

                this.modelNames = _.keys(models);

                Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
                    autoLoad: false,
                    childPageSizeEnabled: true,
                    context: this.getContext().getDataContext(),
                    enableHierarchy: true,
                    fetch: this.columnNames,
                    models: _.clone(this.models),
                    pageSize: 25,
                    remoteSort: true,
                    filters: this.getPermanentFilters(),
                    root: {expanded: true}
                }).then({
                    success: this.addGridBoard,
                    scope: this
                });
            },
            scope: this
        });

    },
    getPermanentFilters: function () {
        var filters = this._getQueryFilter().concat(this._getPortfolioItemFilter());
        this.logger.log('getPermanentFilters', filters);
        return filters;
    },
    _getQueryFilter: function () {
        var query = new Ext.Template(this.getSetting('query')).apply({
            projectName: this.getContext().getProject().Name,
            projectOid: this.getContext().getProject().ObjectID,
            user: this.getContext().getUser()._ref
        });
        if (query) {
            try {
                return [ Rally.data.wsapi.Filter.fromQueryString(query) ];
            } catch(e) {
                Rally.ui.notify.Notifier.showError({ message: e.message });
            }
        }
        return [];
    },
    _getPortfolioItemFilter: function(){
        this.logger.log('_getPortfolioItemFilter', this.portfolioItem)

        if (!this.portfolioItem){
            return [];
        }
        //First verify that the selected portfolio item type is an ancestor to the selected grid type.
        var pi_types = _.map(this.portfolioItemTypes, function(pi){return pi.typePath.toLowerCase()}),
            idx = _.indexOf(pi_types, this.portfolioItem.get('_type').toLowerCase()),
            type_idx = _.indexOf(pi_types, this.getSetting('type').toLowerCase());

        if (type_idx < idx) {
            var properties = [];
            for (var i = type_idx; i < idx; i++) {
                if (i < 0) {
                    properties.push("PortfolioItem");
                } else {
                    properties.push('Parent');
                }
            }
            this.logger.log('_getPortfolioItemFilter', properties);
            return Ext.create('Rally.data.wsapi.Filter', {
                property: properties.join('.'),
                value: this.portfolioItem.get('_ref')
            });
        } else if (type_idx === idx){
            return Ext.create('Rally.data.wsapi.Filter', {
                property: 'ObjectID',
                value: this.portfolioItem.get('ObjectID')
            });
        } else {
            Rally.ui.notify.Notifier.showError({message: "The selected type for the grid results is an ancestor to the selected portfolio item."});
            return [{property: 'ObjectID', value: 0}];
        }
        return [];
    },
    addGridBoard: function (store) {
        this.logger.log('addGridBoard', store, this.getPermanentFilters());
        if (this.getGridboard()) {
            this.getGridboard().destroy();
        }

        var modelNames =  _.clone(this.modelNames),
            context = this.getContext();

        var gridboard = Ext.create('Rally.ui.gridboard.GridBoard', {
            itemId: 'gridboard',
           // stateId: this.getContext().getScopedStateId('gb'),
            toggleState: 'grid',
            modelNames: modelNames,
            context: this.getContext(),
            //** addNewPluginConfig: this.getAddNewConfig(),
            plugins:  [
                'rallygridboardaddnew',
                {
                    ptype: 'rallygridboardfieldpicker',
                    headerPosition: 'left',
                    modelNames: modelNames,
                   // stateful: true,
                   // stateId: this.getContext().getScopedStateId('gb-columns')
                },{
                    ptype: 'rallygridboardcustomfiltercontrol',
                    filterControlConfig: {
                        modelNames: modelNames,
                       // stateful: true,
                       // stateId: this.getContext().getScopedStateId('gb-filter')
                    },
                    showOwnerFilter: true,
                    ownerFilterControlConfig: {
                       // stateful: true,
                       // stateId: this.getContext().getScopedStateId('gb-owner-filter')
                    }
                }

            ],
            storeConfig: {
                filters: this.getPermanentFilters()
            },
            gridConfig: {
               // allColumnsStateful: true,
                store: store,
                columnCfgs: ['Name'],
                height: this.getHeight()
            }
        });

        this.gridboard = this.add(gridboard);

        if (!this.getSetting('showControls')) {
            gridboard.getHeader().hide();
        }
    },
    _shouldEnableAddNew: function() {
        return !_.contains(this.disallowedAddNewTypes, this.getSetting('type').toLowerCase());
    },

    _shouldEnableRanking: function(){
        return this.getSetting('type').toLowerCase() !== 'task';
    }
});