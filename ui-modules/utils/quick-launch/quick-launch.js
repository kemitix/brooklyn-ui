/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import angular from 'angular';
import yaml from 'js-yaml';
import brAutofocus from '../autofocus/autofocus';
import brYamlEditor from '../yaml-editor/yaml-editor';
import template from './quick-launch.html';

const MODULE_NAME = 'brooklyn.components.quick-launch';

angular.module(MODULE_NAME, [brAutofocus, brYamlEditor])
    .directive('brooklynQuickLaunch', quickLaunchDirective);

export default MODULE_NAME;

const BROOKLYN_CONFIG = 'brooklyn.config';

export function quickLaunchDirective() {
    return {
        restrict: 'E',
        template: template,
        scope: {
            app: '=',
            locations: '=',
            args: '=?',
            callback: '=?',
        },
        controller: ['$scope', '$http', '$location', 'brSnackbar', controller]
    };

    function controller($scope, $http, $location, brSnackbar) {
        $scope.deploying = false;
        $scope.model = {
            newConfigFormOpen: false
        };
        $scope.args = $scope.args || {};
        if ($scope.args.location) {
            $scope.model.location = $scope.args.location;
        }
        $scope.toggleNewConfigForm = toggleNewConfigForm;
        $scope.addNewConfigKey = addNewConfigKey;
        $scope.deleteConfigField = deleteConfigField;
        $scope.deployApp = deployApp;
        $scope.showEditor = showEditor;
        $scope.openComposer = openComposer;
        $scope.hideEditor = hideEditor;
        $scope.clearError = clearError;

        $scope.$watch('app', () => {
            $scope.clearError();
            $scope.editorYaml = $scope.app.plan.data;
            var parsedPlan = null;
            try {
                parsedPlan = yaml.safeLoad($scope.editorYaml);
            } catch (e) { /* ignore, it's an unparseable template */ }
            // enable wizard if it's parseble and doesn't specify a location
            // (if it's not parseable, or it specifies a location, then the YAML view is displayed)
            $scope.appHasWizard = parsedPlan!=null && !checkForLocationTags(parsedPlan);
            $scope.yamlViewDisplayed = !$scope.appHasWizard;
            $scope.entityToDeploy = {
                type: $scope.app.symbolicName
            };
            if ($scope.app.config) {
                $scope.configMap = $scope.app.config.reduce((result, config) => {
                    result[config.name] = config;
                    if (config.pinned || (angular.isArray(config.contraints) && config.constraints.indexOf('required') > -1 && (!config.defaultValue === undefined || config.defaultValue === ''))) {
                        if (!$scope.entityToDeploy.hasOwnProperty(BROOKLYN_CONFIG)) {
                            $scope.entityToDeploy[BROOKLYN_CONFIG] = {};
                        }

                        $scope.entityToDeploy[BROOKLYN_CONFIG][config.name] = config.defaultValue || null;
                    }
                    return result;
                }, {});
            } else {
                $scope.configMap = {};
            }
        });
        $scope.$watch('editorYaml', () => {
            $scope.clearError();
        });
        $scope.$watch('entityToDeploy', () => {
            $scope.clearError();
        }, true);
        $scope.$watch('model.name', () => {
            $scope.clearError();
        });
        $scope.$watch('model.location', () => {
            $scope.clearError();
        });

        function deployApp() {
            $scope.deploying = true;
            let appYaml;
            if ($scope.yamlViewDisplayed) {
                appYaml = angular.copy($scope.editorYaml);
            } else {
                appYaml = buildYaml();
            }
            $http({
                method: 'POST',
                url: '/v1/applications',
                data: appYaml
            }).then((response) => {
                if ($scope.callback) {
                    $scope.callback.apply({}, [{state: 'SUCCESS', data: response.data}]);
                } else {
                    brSnackbar.create('Application Deployed');
                }
                $scope.deploying = false;
            }, (response) => {
                $scope.model.deployError = response.data.message;
                $scope.deploying = false;
            });
        }

        function toggleNewConfigForm() {
            $scope.model.newConfigFormOpen = !$scope.model.newConfigFormOpen;
            if ($scope.model.newConfigFormOpen) {
                delete $scope.model.newKey;
            }
        }

        function deleteConfigField(key) {
            delete $scope.entityToDeploy[BROOKLYN_CONFIG][key];
            if (Object.keys($scope.entityToDeploy[BROOKLYN_CONFIG]).length === 0) {
                delete $scope.entityToDeploy[BROOKLYN_CONFIG];
            }
        }

        function addNewConfigKey() {
            if ($scope.model.newKey && $scope.model.newKey.length > 0) {
                let newConfigValue = null;
                if ($scope.configMap.hasOwnProperty($scope.model.newKey) &&
                    $scope.configMap[$scope.model.newKey].hasOwnProperty('defaultValue')) {
                    newConfigValue = $scope.configMap[$scope.model.newKey].defaultValue;
                }
                if ($scope.configMap.hasOwnProperty($scope.model.newKey) &&
                    $scope.configMap[$scope.model.newKey].type === 'java.lang.Boolean' &&
                    newConfigValue === null) {
                    newConfigValue = false;
                }

                if (!$scope.entityToDeploy.hasOwnProperty(BROOKLYN_CONFIG)) {
                    $scope.entityToDeploy[BROOKLYN_CONFIG] = {};
                }
                $scope.entityToDeploy[BROOKLYN_CONFIG][$scope.model.newKey] = newConfigValue;
                $scope.focus = $scope.model.newKey;
            }
            $scope.model.newConfigFormOpen = false;
        }

        function buildYaml() {
            let newApp = {
                name: $scope.model.name || $scope.app.displayName,
                location: $scope.model.location || '<REPLACE>',
                services: [
                    angular.copy($scope.entityToDeploy)
                ]
            };
            return yaml.safeDump(newApp);
        }

        function buildComposerYaml() {
            if ($scope.yamlViewDisplayed) {
                return angular.copy($scope.editorYaml);
            } else {
                let newApp = {
                    name: $scope.model.name || $scope.app.displayName,
                };
                if ($scope.model.location) {
                    newApp.location = $scope.model.location;
                }
                if ($scope.entityToDeploy[BROOKLYN_CONFIG]) {
                    newApp[BROOKLYN_CONFIG] = $scope.entityToDeploy[BROOKLYN_CONFIG]
                }
                // TODO if plan data has config in the root (unlikely) this will have errors
                return yaml.safeDump(newApp) + "\n" + $scope.app.plan.data;
            }
        }

        function showEditor() {
            $scope.editorYaml = buildYaml();
            $scope.yamlViewDisplayed = true;
        }

        function hideEditor() {
            $scope.yamlViewDisplayed = false;
        }

        function openComposer() {
            window.location.href = '/brooklyn-ui-blueprint-composer/#!/graphical?'+
                'yaml='+encodeURIComponent(buildComposerYaml());
        }

        function clearError() {
            delete $scope.model.deployError;
        }
    }

    function checkForLocationTags(parsedPlan) {
        return reduceFunction(false, parsedPlan);

        function reduceFunction(locationFound, entity) {
            if (entity.hasOwnProperty('location') || entity.hasOwnProperty('location')) {
                return true;
            }
            if (!locationFound && entity.hasOwnProperty('brooklyn.children')) {
                entity['brooklyn.children'].reduce(reduceFunction, locationFound);
            } else if (!locationFound && entity.hasOwnProperty('services')) {
                entity['services'].reduce(reduceFunction, locationFound);
            }
            return locationFound;
        }
    }
}
