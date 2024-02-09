/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import * as path from "path";
import * as fs from "fs";
import * as zowe from "@zowe/cli";
import * as extend from "../extend";
import { FileManagement } from "../utils";
import { Validation } from "./Validation";
import { ZeApiConvertResponse } from "../globals";

export class ProfilesCache {
    public profilesForValidation: Validation.IValidationProfile[] = [];
    public profilesValidationSetting: Validation.IValidationSetting[] = [];
    public allProfiles: zowe.imperative.IProfileLoaded[] = [];
    public profileTypeConfigurations: zowe.imperative.ICommandProfileTypeConfiguration[] = [];
    protected allTypes: string[];
    protected allExternalTypes = new Set<string>();
    protected profilesByType = new Map<string, zowe.imperative.IProfileLoaded[]>();
    protected defaultProfileByType = new Map<string, zowe.imperative.IProfileLoaded>();
    protected profileManagerByType = new Map<string, zowe.imperative.CliProfileManager>();

    public constructor(protected log: zowe.imperative.Logger, protected cwd?: string) {
        this.cwd = cwd != null ? FileManagement.getFullPath(cwd) : undefined;
    }

    public static requireKeyring(this: void): NodeModule {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-var-requires
        return require("@zowe/secrets-for-zowe-sdk").keyring;
    }

    public addToConfigArray(extendermetadata: zowe.imperative.ICommandProfileTypeConfiguration[]): void {
        extendermetadata?.forEach((item) => {
            const index = this.profileTypeConfigurations.findIndex((ele) => ele.type == item.type);
            if (index !== -1) {
                this.profileTypeConfigurations[index] = item;
            } else {
                this.profileTypeConfigurations.push(item);
            }
        });
    }

    public getConfigArray(): zowe.imperative.ICommandProfileTypeConfiguration[] {
        return this.profileTypeConfigurations;
    }

    public async getProfileInfo(_envTheia = false): Promise<zowe.imperative.ProfileInfo> {
        const mProfileInfo = new zowe.imperative.ProfileInfo("zowe", {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            credMgrOverride: zowe.imperative.ProfileCredentials.defaultCredMgrWithKeytar(ProfilesCache.requireKeyring),
        });
        await mProfileInfo.readProfilesFromDisk({ homeDir: FileManagement.getZoweDir(), projectDir: this.cwd ?? undefined });
        return mProfileInfo;
    }

    /**
     * Loads the named profile from allProfiles
     *
     * @param {string} name Name of Profile
     * @param {string} type Type of Profile, optional
     *
     * @returns {IProfileLoaded}
     */
    public loadNamedProfile(name: string, type?: string): zowe.imperative.IProfileLoaded {
        for (const profile of this.allProfiles) {
            if (profile.name === name && (!type || profile.type === type)) {
                return profile;
            }
        }
        throw new Error(`Zowe Explorer Profiles Cache error: Could not find profile named: ${name}.`);
    }

    /**
     * Updates profile in allProfiles array and if default updates defaultProfileByType
     *
     * @param {string} profileLoaded
     *
     * @returns {void}
     */
    public updateProfilesArrays(profileLoaded: zowe.imperative.IProfileLoaded): void {
        // update allProfiles array
        const promptedTypeIndex = this.allProfiles.findIndex(
            (profile) => profile?.type === profileLoaded?.type && profile?.name === profileLoaded?.name
        );
        this.allProfiles[promptedTypeIndex] = profileLoaded;
        // checks if default, if true update defaultProfileByType
        const defaultProf = this.defaultProfileByType.get(profileLoaded?.type);
        if (defaultProf?.name === profileLoaded?.name) {
            this.defaultProfileByType.set(profileLoaded?.type, profileLoaded);
        }
    }

    /**
     * This returns default profile by type from defaultProfileByType
     *
     * @param {string} type Name of Profile, defaults to "zosmf" if nothing passed.
     *
     * @returns {IProfileLoaded}
     */
    public getDefaultProfile(type = "zosmf"): zowe.imperative.IProfileLoaded {
        return this.defaultProfileByType.get(type);
    }

    /**
     * Gets default Profile attributes from imperative
     *
     * @param {ProfileInfo} mProfileInfo
     * @param {string} profileType Type of Profile
     *
     * @returns {IProfAttrs}
     */
    public getDefaultConfigProfile(mProfileInfo: zowe.imperative.ProfileInfo, profileType: string): zowe.imperative.IProfAttrs {
        return mProfileInfo.getDefaultProfile(profileType);
    }

    /**
     * Gets array of profiles by type
     *
     * @param {string} type Type of Profile, defaults to "zosmf" if nothing passed.
     *
     * @returns {IProfileLoaded[]}
     */
    public getProfiles(type = "zosmf"): zowe.imperative.IProfileLoaded[] {
        return this.profilesByType.get(type);
    }

    /**
     * Used for extenders to register with Zowe Explorer that do not need their
     * profile type in the existing MVS, USS, and JES
     *
     * @param {string} profileTypeName Type of Profile
     *
     * @returns {void}
     */
    public registerCustomProfilesType(profileTypeName: string): void {
        this.allExternalTypes.add(profileTypeName);
    }

    public async refresh(apiRegister?: extend.IRegisterClient): Promise<void> {
        this.allProfiles = [];
        this.allTypes = [];
        let mProfileInfo: zowe.imperative.ProfileInfo;
        try {
            mProfileInfo = await this.getProfileInfo();
            if (!mProfileInfo.usingTeamConfig) {
                return;
            }
            const allTypes = this.getAllProfileTypes(apiRegister.registeredApiTypes());
            allTypes.push("ssh", "base");
            for (const type of allTypes) {
                const tmpAllProfiles: zowe.imperative.IProfileLoaded[] = [];
                // Step 1: Get all profiles for each registered type
                const profilesForType = mProfileInfo.getAllProfiles(type).filter((temp) => temp.profLoc.osLoc.length !== 0);
                if (profilesForType && profilesForType.length > 0) {
                    for (const prof of profilesForType) {
                        // Step 2: Merge args for each profile
                        const profAttr = this.getMergedAttrs(mProfileInfo, prof);
                        // Work-around. TODO: Discuss with imperative team
                        const profileFix = this.getProfileLoaded(prof.profName, prof.profType, profAttr);
                        // set default for type
                        if (prof.isDefaultProfile) {
                            this.defaultProfileByType.set(type, profileFix);
                        }

                        // Step 3: Update allProfiles list
                        tmpAllProfiles.push(profileFix);
                    }
                    this.allProfiles.push(...tmpAllProfiles);
                    this.profilesByType.set(type, tmpAllProfiles);
                }
                this.allTypes.push(type);
            }
            // check for proper merging of apiml tokens
            this.checkMergingConfigAllProfiles();
            this.profilesForValidation = [];
        } catch (error) {
            this.log.error(error as string);
        }
    }

    public validateAndParseUrl(newUrl: string): Validation.IValidationUrl {
        let url: URL;

        const validationResult: Validation.IValidationUrl = {
            valid: false,
            protocol: null,
            host: null,
            port: null,
        };

        try {
            url = new URL(newUrl);
        } catch (error) {
            this.log.debug(error as string);
            return validationResult;
        }

        if (newUrl.includes(":443")) {
            validationResult.port = zowe.imperative.AbstractSession.DEFAULT_HTTPS_PORT;
        } else {
            validationResult.port = Number(url.port);
        }

        validationResult.protocol = url.protocol.slice(0, -1);
        validationResult.host = url.hostname;
        validationResult.valid = true;
        return validationResult;
    }

    /**
     * get array of profile types
     * @returns string[]
     */
    public getAllTypes(): string[] {
        return this.allTypes;
    }

    /**
     * get array of Profile names by type
     * @param type  profile type
     * @returns string[]
     */
    public async getNamesForType(type: string): Promise<string[]> {
        const mProfileInfo = await this.getProfileInfo();
        const profilesForType = mProfileInfo.getAllProfiles(type);
        return profilesForType.map((profAttrs) => profAttrs.profName);
    }

    /**
     * get array of IProfileLoaded by type
     * @param type profile type
     * @returns IProfileLoaded[]
     */
    public async fetchAllProfilesByType(type: string): Promise<zowe.imperative.IProfileLoaded[]> {
        const profByType: zowe.imperative.IProfileLoaded[] = [];
        const mProfileInfo = await this.getProfileInfo();
        const profilesForType = mProfileInfo.getAllProfiles(type);
        if (profilesForType && profilesForType.length > 0) {
            for (const prof of profilesForType) {
                const profAttr = this.getMergedAttrs(mProfileInfo, prof);
                let profile = this.getProfileLoaded(prof.profName, prof.profType, profAttr);
                profile = this.checkMergingConfigSingleProfile(profile);
                profByType.push(profile);
            }
        }
        return profByType;
    }

    /**
     * get array of IProfileLoaded for all profiles
     * @returns IProfileLoaded[]
     */
    public async fetchAllProfiles(): Promise<zowe.imperative.IProfileLoaded[]> {
        const profiles: zowe.imperative.IProfileLoaded[] = [];
        for (const type of this.allTypes) {
            const profsByType = await this.fetchAllProfilesByType(type);
            profiles.push(...profsByType);
        }
        this.allProfiles = profiles;
        return profiles;
    }

    /**
     * Direct load and return of particular IProfileLoaded
     * @param type profile type
     * @param name profile name
     * @returns IProfileLoaded
     */
    public async directLoad(type: string, name: string): Promise<zowe.imperative.IProfileLoaded | undefined> {
        const profsOfType = await this.fetchAllProfilesByType(type);
        if (profsOfType && profsOfType.length > 0) {
            for (const profile of profsOfType) {
                if (profile.name === name) {
                    return profile;
                }
            }
        }
    }

    public async getProfileFromConfig(profileName: string, profileType?: string): Promise<zowe.imperative.IProfAttrs | undefined> {
        const mProfileInfo = await this.getProfileInfo();
        const configAllProfiles = mProfileInfo.getAllProfiles().filter((prof) => prof.profLoc.osLoc.length !== 0);
        return configAllProfiles.find((prof) => prof.profName === profileName && (!profileType || prof.profType === profileType));
    }

    public async getLoadedProfConfig(profileName: string, profileType?: string): Promise<zowe.imperative.IProfileLoaded | undefined> {
        const mProfileInfo = await this.getProfileInfo();
        const currentProfile = await this.getProfileFromConfig(profileName, profileType);
        if (currentProfile == null) {
            return undefined;
        }
        const profile = this.getMergedAttrs(mProfileInfo, currentProfile);
        return this.getProfileLoaded(currentProfile.profName, currentProfile.profType, profile);
    }

    // This will retrieve the saved base profile in the allProfiles array
    public getBaseProfile(): zowe.imperative.IProfileLoaded | undefined {
        let baseProfile: zowe.imperative.IProfileLoaded;
        for (const baseP of this.allProfiles) {
            if (baseP.type === "base") {
                baseProfile = baseP;
            }
        }
        return baseProfile;
    }

    // This will retrieve the base profile from imperative
    public async fetchBaseProfile(): Promise<zowe.imperative.IProfileLoaded | undefined> {
        const mProfileInfo = await this.getProfileInfo();
        const baseProfileAttrs = mProfileInfo.getDefaultProfile("base");
        if (baseProfileAttrs == null) {
            return undefined;
        }
        const profAttr = this.getMergedAttrs(mProfileInfo, baseProfileAttrs);
        return this.getProfileLoaded(baseProfileAttrs.profName, baseProfileAttrs.profType, profAttr);
    }

    /**
     * This returns true or false depending on if credentials are stored securely.
     *
     * @returns {boolean}
     */
    public async isCredentialsSecured(): Promise<boolean> {
        try {
            return (await this.getProfileInfo()).isSecured();
        } catch (error) {
            this.log.error(error as string);
        }
        return true;
    }

    public getProfileLoaded(profileName: string, profileType: string, profile: zowe.imperative.IProfile): zowe.imperative.IProfileLoaded {
        return {
            message: "",
            name: profileName,
            type: profileType,
            profile,
            failNotFound: false,
        };
    }

    public async convertV1ProfToConfig(): Promise<ZeApiConvertResponse> {
        const successMsg: String[] = [];
        const warningMsg: String[] = [];
        const zoweDir = FileManagement.getZoweDir();
        const profilesPath = path.join(zoweDir, "profiles");
        const oldProfilesPath = `${profilesPath.replace(/[\\/]$/, "")}-old`;
        const convertResult = await zowe.imperative.ConfigBuilder.convert(profilesPath);
        for (const [k, v] of Object.entries(convertResult.profilesConverted)) {
            successMsg.push(`Converted ${k} profiles: ${v.join(", ")}\n`);
        }
        if (convertResult.profilesFailed.length > 0) {
            warningMsg.push(`Failed to convert ${convertResult.profilesFailed.length} profile(s). See details below\n`);
            for (const { name, type, error } of convertResult.profilesFailed) {
                if (name != null) {
                    warningMsg.push(`Failed to load ${type} profile "${name}":\n    ${String(error)}\n`);
                } else {
                    warningMsg.push(`Failed to find default ${type} profile:\n    ${String(error)}\n`);
                }
            }
        }
        const teamConfig = await zowe.imperative.Config.load("zowe", {
            homeDir: zoweDir,
            projectDir: false,
        });
        teamConfig.api.layers.activate(false, true);
        teamConfig.api.layers.merge(convertResult.config);
        const impConfig: zowe.imperative.IImperativeConfig = zowe.getImperativeConfig();
        const knownCliConfig: zowe.imperative.ICommandProfileTypeConfiguration[] = impConfig.profiles;
        knownCliConfig.push(impConfig.baseProfile);
        this.addToConfigArray(knownCliConfig);
        teamConfig.setSchema(zowe.imperative.ConfigSchema.buildSchema(this.getConfigArray()));
        await teamConfig.save();
        try {
            fs.renameSync(profilesPath, oldProfilesPath);
        } catch (error) {
            warningMsg.push(`Failed to rename profiles directory to ${oldProfilesPath}:\n    ${String(error)}`);
        }
        successMsg.push(`Your new profiles have been saved to ${teamConfig.layerActive().path}.\n`);
        return {
            success: String(successMsg),
            warnings: String(warningMsg),
            convertResult,
        };
    }

    // used by refresh to check correct merging of allProfiles
    protected checkMergingConfigAllProfiles(): void {
        const baseProfile = this.defaultProfileByType.get("base");
        const allProfiles: zowe.imperative.IProfileLoaded[] = [];
        this.allTypes.forEach((type) => {
            try {
                const allProfilesByType: zowe.imperative.IProfileLoaded[] = [];
                const profByType = this.profilesByType.get(type);
                profByType.forEach((profile) => {
                    if (this.shouldRemoveTokenFromProfile(profile, baseProfile)) {
                        profile.profile.tokenType = undefined;
                        profile.profile.tokenValue = undefined;
                        // update default profile of type if changed
                        if (profile.name === this.defaultProfileByType.get(type).name) {
                            this.defaultProfileByType.set(type, profile);
                        }
                    }
                    allProfiles.push(profile);
                    allProfilesByType.push(profile);
                });
                this.profilesByType.set(type, allProfilesByType);
            } catch (error) {
                // do nothing, skip if profile type is not included in config file
                this.log.debug(error as string);
            }
        });
        this.allProfiles = [];
        this.allProfiles.push(...allProfiles);
    }

    // check correct merging of a single profile
    protected checkMergingConfigSingleProfile(profile: zowe.imperative.IProfileLoaded): zowe.imperative.IProfileLoaded {
        const baseProfile = this.defaultProfileByType.get("base");
        if (this.shouldRemoveTokenFromProfile(profile, baseProfile)) {
            profile.profile.tokenType = undefined;
            profile.profile.tokenValue = undefined;
        }
        return profile;
    }

    protected getMergedAttrs(mProfileInfo: zowe.imperative.ProfileInfo, profAttrs: zowe.imperative.IProfAttrs): zowe.imperative.IProfile {
        const profile: zowe.imperative.IProfile = {};
        if (profAttrs != null) {
            const mergedArgs = mProfileInfo.mergeArgsForProfile(profAttrs, { getSecureVals: true });
            for (const arg of mergedArgs.knownArgs) {
                profile[arg.argName] = arg.argValue;
            }
        }
        return profile;
    }

    // create an array that includes registered types from apiRegister.registeredApiTypes()
    // and allExternalTypes
    private getAllProfileTypes(registeredTypes: string[]): string[] {
        const externalTypeArray: string[] = Array.from(this.allExternalTypes);
        const allTypes = registeredTypes.concat(externalTypeArray.filter((exType) => registeredTypes.every((type) => type !== exType)));
        return allTypes;
    }

    private shouldRemoveTokenFromProfile(profile: zowe.imperative.IProfileLoaded, baseProfile: zowe.imperative.IProfileLoaded): boolean {
        return (
            baseProfile?.profile?.host &&
            baseProfile?.profile?.port &&
            profile?.profile?.host &&
            profile?.profile?.port &&
            (baseProfile?.profile.host !== profile?.profile.host || baseProfile?.profile.port !== profile?.profile.port) &&
            profile?.profile.tokenType === zowe.imperative.SessConstants.TOKEN_TYPE_APIML
        );
    }
}
